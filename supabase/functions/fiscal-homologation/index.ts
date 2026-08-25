import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.0";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const envPresent=(name:string)=>Boolean(Deno.env.get(name)?.trim());
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,"0")).join("");

Deno.serve(async(req)=>{
 try{
  if(req.method!=="POST")return json({error:"Método inválido"},405);
  const auth=req.headers.get("authorization");if(!auth)return json({error:"Não autenticado"},401);
  const url=Deno.env.get("SUPABASE_URL")!;const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await userClient.auth.getUser();if(!user)return json({error:"Sessão inválida"},401);
  const admin=createClient(url,serviceKey);const body=await req.json().catch(()=>({}));
  const tenantId=String(body.tenantId??"");const action=String(body.action??"preflight");
  if(!tenantId)return json({error:"Empresa obrigatória"},400);
  const {data:membership}=await admin.from("tenant_memberships").select("role").eq("tenant_id",tenantId).eq("user_id",user.id).eq("active",true).in("role",["owner","admin","manager"]).maybeSingle();
  if(!membership)return json({error:"Sem permissão fiscal"},403);
  const {data:settings,error:settingsError}=await admin.from("fiscal_settings").select("*").eq("tenant_id",tenantId).maybeSingle();
  if(settingsError)throw settingsError;if(!settings)return json({error:"Emitente fiscal não configurado"},409);
  if(settings.environment!=="homologation")return json({error:"Gateway aceita somente ambiente de homologação"},409);

  const secrets={certificate:envPresent("FISCAL_A1_PFX_BASE64"),certificatePassword:envPresent("FISCAL_A1_PASSWORD"),
    nfeEndpoint:envPresent("SEFAZ_PB_NFE_AUTH_URL_HOMOLOGATION"),nfceEndpoint:envPresent("SEFAZ_PB_NFCE_AUTH_URL_HOMOLOGATION")};
  const issuerErrors:string[]=[];
  if(!/^\d{14}$/.test(String(settings.tax_id??"")))issuerErrors.push("CNPJ do emitente inválido");
  if(!String(settings.state_tax_id??"").trim())issuerErrors.push("Inscrição estadual ausente");
  if(settings.state!=="PB")issuerErrors.push("Este gateway está configurado para SEFAZ-PB");
  if(!/^\d{7}$/.test(String(settings.city_code??"")))issuerErrors.push("Código IBGE do município inválido");
  const [{count:activeProducts},{count:fiscalProfiles}]=await Promise.all([
    admin.from("products").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId).eq("active",true),
    admin.from("product_fiscal_profiles").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId)]);
  const missingProfiles=Math.max(0,(activeProducts??0)-(fiscalProfiles??0));
  const missingSecrets=Object.entries(secrets).filter(([,ok])=>!ok).map(([name])=>name);
  const ready=issuerErrors.length===0&&missingSecrets.length===0&&missingProfiles===0;
  const details={ready,secrets,issuerErrors,activeProducts:activeProducts??0,fiscalProfiles:fiscalProfiles??0,missingProfiles,
    schemaVersion:"4.00",transport:"direct_sefaz_pb",checkedAt:new Date().toISOString()};
  await admin.from("fiscal_settings").update({homologation_status:ready?"ready":missingSecrets.length?"credentials_missing":"failed",
    homologation_checked_at:new Date().toISOString(),homologation_details:details,transmission_enabled:false,updated_by:user.id}).eq("id",settings.id);
  if(action==="preflight")return json(details);

  if(action!=="prepare")return json({error:"Ação inválida"},400);
  const documentId=String(body.documentId??"");if(!documentId)return json({error:"Documento obrigatório"},400);
  const [{data:doc,error:docError},{data:items,error:itemsError}]=await Promise.all([
    admin.from("fiscal_documents").select("*").eq("id",documentId).eq("tenant_id",tenantId).single(),
    admin.from("fiscal_document_items").select("*").eq("fiscal_document_id",documentId).eq("tenant_id",tenantId).order("line_number")]);
  if(docError||!doc)return json({error:"Documento fiscal não encontrado"},404);if(itemsError)throw itemsError;
  const errors:string[]=[...issuerErrors];
  if(doc.environment!=="homologation")errors.push("Documento fora do ambiente de homologação");
  if(!["draft","validation_failed"].includes(doc.status))errors.push("Status do documento não permite preparação");
  if(!items?.length)errors.push("Documento sem itens");
  for(const item of items??[]){if(!/^\d{8}$/.test(String(item.ncm??"")))errors.push(`Item ${item.line_number}: NCM inválido`);
    if(!/^\d{4}$/.test(String(item.cfop??"")))errors.push(`Item ${item.line_number}: CFOP de saída inválido`);
    if(Number(item.quantity)<=0||Number(item.unit_value)<0)errors.push(`Item ${item.line_number}: quantidade/valor inválido`);}
  const canonical=JSON.stringify({schemaVersion:"4.00",model:doc.model,series:doc.series,number:doc.number,issuer:settings.tax_id,
    recipient:doc.recipient_tax_id,totals:doc.totals,items:(items??[]).map((i:any)=>({line:i.line_number,sku:i.sku,ncm:i.ncm,cfop:i.cfop,qty:i.quantity,value:i.unit_value,tax:i.tax_snapshot}))});
  const requestHash=await sha256(canonical);const canQueue=errors.length===0&&ready;
  const {data:job,error:jobError}=await admin.from("fiscal_transmission_jobs").insert({tenant_id:tenantId,fiscal_document_id:documentId,
    operation:"authorize",environment:"homologation",status:canQueue?"queued":"manual_review",request_hash:requestHash,
    response_code:canQueue?"READY_FOR_SIGNING":"PREFLIGHT_BLOCKED",response_message:canQueue?"Pronto para assinatura XML e transporte SEFAZ":"Pendências impedem transmissão",
    diagnostics:{errors,missingSecrets,missingProfiles,schemaVersion:"4.00"},created_by:user.id}).select("id,status").single();
  if(jobError&&jobError.code!=="23505")throw jobError;
  await admin.from("fiscal_documents").update({status:canQueue?"queued":"validation_failed",validation_errors:errors,updated_by:user.id}).eq("id",documentId).eq("tenant_id",tenantId);
  await admin.from("fiscal_document_events").insert({tenant_id:tenantId,fiscal_document_id:documentId,event_type:canQueue?"queued":"error",
    message:canQueue?"Documento validado e enfileirado para assinatura":"Pré-validação fiscal bloqueou a transmissão",payload:{requestHash,errors,missingSecrets,missingProfiles},created_by:user.id});
  return json({ok:canQueue,job:job??null,requestHash,errors,missingSecrets,missingProfiles},canQueue?200:422);
 }catch(error){console.error(error);return json({error:error instanceof Error?error.message:"Erro inesperado"},500)}
});
