import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireTenantRole } from "./auth-guards";
import { requireSupplyRole, SUPPLY_APPROVE_ROLES, SUPPLY_READ_ROLES } from "./supplies.server";

export type FiscalSettingsInput = {
  id?: string; branchId: string; environment: "homologation" | "production"; provider: string;
  legalName: string; tradeName?: string; taxId: string; stateTaxId: string; taxRegime: string; crt: number;
  state: string; cityCode: string; city: string; zipCode: string; street: string; number: string;
  complement?: string; district: string; phone?: string; email?: string; nfeSeries?: number; nfceSeries?: number;
};

export type FiscalProfileInput = {
  productIds: string[]; ncm: string; cest?: string; origin: number; cfopInState: string; cfopOutState: string;
  icmsCst?: string; icmsCsosn?: string; icmsRate?: number; pisCst?: string; pisRate?: number;
  cofinsCst?: string; cofinsRate?: number; notes?: string;
};

export type FiscalCsvRow = {
  productId: string; sku?: string; name?: string; ncm: string; cest?: string; origin: number | string;
  cfopInState: string; cfopOutState: string; icmsCst?: string; icmsCsosn?: string; icmsRate?: number | string;
  pisCst?: string; pisRate?: number | string; cofinsCst?: string; cofinsRate?: number | string; notes?: string;
};

export type FiscalDraftResult = { ok: boolean; reused: boolean; document_id: string; status: string; series?: number; number?: number };

export type FiscalCertificateInput = {
  settingId: string;
  fileName: string;
  pfxBase64: string;
  password: string;
};

export const getFiscalOverview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb=tdb(context.supabase); const membership=await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_READ_ROLES);
    const [settings,documents,branches,paidOrders,profiles,products,jobs]=await Promise.all([
      sb.from("fiscal_settings").select("*").eq("tenant_id",context.tenantId).order("created_at").limit(10),
      sb.from("fiscal_documents").select("id,order_id,model,environment,series,number,status,access_key,protocol,issued_at,authorized_at,created_at,recipient_name,totals")
        .eq("tenant_id",context.tenantId).order("created_at",{ascending:false}).limit(100),
      sb.from("branches").select("id,name,code,city,state,is_main,active").eq("tenant_id",context.tenantId).eq("active",true).order("is_main",{ascending:false}),
      sb.from("orders").select("id,status,total,customer_name,customer_document,created_at")
        .eq("tenant_id",context.tenantId).in("status",["pago","faturado","enviado","entregue"]).order("created_at",{ascending:false}).limit(50),
      sb.from("product_fiscal_profiles").select("product_id").eq("tenant_id",context.tenantId),
      sb.from("products").select("id").eq("tenant_id",context.tenantId).eq("active",true).limit(10000),
      sb.from("fiscal_transmission_jobs").select("id,fiscal_document_id,operation,status,response_code,response_message,diagnostics,created_at").eq("tenant_id",context.tenantId).order("created_at",{ascending:false}).limit(50),
    ]);
    for(const r of [settings,documents,branches,paidOrders,profiles,products,jobs]) if(r.error) throw new Error(r.error.message);
    const docs=(documents.data??[]) as any[]; const documented=new Set(docs.map(d=>d.order_id).filter(Boolean));
    const profiled=new Set(((profiles.data??[]) as any[]).map(p=>p.product_id));
    return { tenantId:context.tenantId,canManageCertificate:["owner","admin"].includes(membership.role),settings:settings.data??[],documents:docs,jobs:jobs.data??[],branches:branches.data??[],
      pendingOrders:((paidOrders.data??[]) as any[]).filter(o=>!documented.has(o.id)),
      missingFiscalProfiles:((products.data??[]) as any[]).filter(p=>!profiled.has(p.id)).length,
      productsCount:(products.data??[]).length };
  });

export const getFiscalProductQueue = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:{search?:string})=>input)
  .handler(async({data,context})=>{
    const sb=tdb(context.supabase);await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_READ_ROLES);
    const [products,profiles]=await Promise.all([
      sb.from("products").select("id,sku,internal_code,manufacturer_code,gtin,name,active")
        .eq("tenant_id",context.tenantId).eq("active",true).order("name").limit(10000),
      sb.from("product_fiscal_profiles").select("product_id,ncm,cest,origin,cfop_in_state,cfop_out_state,icms_cst,icms_csosn,pis_cst,cofins_cst,updated_at")
        .eq("tenant_id",context.tenantId),
    ]);
    if(products.error)throw new Error(products.error.message);if(profiles.error)throw new Error(profiles.error.message);
    const approved=new Map(((profiles.data??[]) as any[]).map(p=>[p.product_id,p]));
    const term=String(data.search??"").trim().toLowerCase();
    const missing=((products.data??[]) as any[]).filter(p=>!approved.has(p.id))
      .filter(p=>!term||[p.name,p.sku,p.internal_code,p.manufacturer_code,p.gtin].some(v=>String(v??"").toLowerCase().includes(term)))
      .slice(0,200);
    const ids=missing.map(p=>p.id);let candidates:any[]=[];
    if(ids.length){
      const nfe=await sb.from("nfe_import_items").select("product_id,ncm,cfop,created_at")
        .eq("tenant_id",context.tenantId).in("product_id",ids).not("ncm","is",null).order("created_at",{ascending:false}).limit(2000);
      if(nfe.error)throw new Error(nfe.error.message);candidates=(nfe.data??[]) as any[];
    }
    const candidateByProduct=new Map<string,any>();
    for(const c of candidates)if(c.product_id&&!candidateByProduct.has(c.product_id)&&/^\d{8}$/.test(String(c.ncm??"")))candidateByProduct.set(c.product_id,c);
    return {items:missing.map(p=>({...p,candidate:candidateByProduct.get(p.id)??null})),approvedCount:approved.size,totalProducts:(products.data??[]).length,missingCount:(products.data??[]).length-approved.size};
  });

export const saveFiscalSettings = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:FiscalSettingsInput)=>input).handler(async({data,context})=>{
    const sb=tdb(context.supabase);await requireTenantRole(sb,context.userId,context.tenantId,["owner","admin"]);
    const digits=(v:string)=>String(v??"").replace(/\D/g,"");
    if(digits(data.taxId).length!==14)throw new Error("CNPJ deve conter 14 dígitos");
    if(!data.legalName.trim()||!data.stateTaxId.trim())throw new Error("Razão social e inscrição estadual são obrigatórias");
    if(!/^[A-Z]{2}$/.test(data.state.toUpperCase()))throw new Error("UF inválida");
    const row={tenant_id:context.tenantId,branch_id:data.branchId,environment:data.environment,provider:data.provider,
      legal_name:data.legalName.trim(),trade_name:data.tradeName?.trim()||null,tax_id:digits(data.taxId),state_tax_id:data.stateTaxId.trim(),
      tax_regime:data.taxRegime,crt:Number(data.crt),state:data.state.toUpperCase(),city_code:digits(data.cityCode),city:data.city.trim(),
      zip_code:digits(data.zipCode),street:data.street.trim(),number:data.number.trim(),complement:data.complement?.trim()||null,
      district:data.district.trim(),phone:data.phone?.trim()||null,email:data.email?.trim()||null,nfe_series:Number(data.nfeSeries??1),
      nfce_series:Number(data.nfceSeries??1),enabled:data.environment==="homologation",updated_by:context.userId};
    if(data.id){const{error}=await sb.from("fiscal_settings").update(row).eq("id",data.id).eq("tenant_id",context.tenantId);if(error)throw new Error(error.message);return{ok:true,id:data.id};}
    const{data:created,error}=await sb.from("fiscal_settings").insert({...row,created_by:context.userId}).select("id").single();
    if(error)throw new Error(error.message);return{ok:true,id:created.id as string};
  });

export const saveFiscalCertificate = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:FiscalCertificateInput)=>input)
  .handler(async({data,context})=>{
    const sb=tdb(context.supabase);await requireTenantRole(sb,context.userId,context.tenantId,["owner","admin"]);
    const fileName=String(data.fileName??"").trim();
    const password=String(data.password??"");
    const pfxBase64=String(data.pfxBase64??"").replace(/^data:[^;]+;base64,/,"").replace(/\s/g,"");
    if(!data.settingId)throw new Error("Configure o emitente antes de enviar o certificado");
    if(!/\.(pfx|p12)$/i.test(fileName))throw new Error("Selecione um certificado A1 no formato .pfx ou .p12");
    if(!password||password.length>256)throw new Error("Informe a senha válida do certificado A1");
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(pfxBase64))throw new Error("Arquivo de certificado inválido");
    const bytes=Buffer.from(pfxBase64,"base64");
    if(bytes.length<32||bytes.length>1_048_576)throw new Error("O certificado deve ter entre 32 bytes e 1 MB");
    if(bytes[0]!==0x30)throw new Error("O arquivo não parece ser um certificado PKCS#12 válido");
    const {data:setting,error:settingError}=await sb.from("fiscal_settings").select("id,homologation_details")
      .eq("id",data.settingId).eq("tenant_id",context.tenantId).maybeSingle();
    if(settingError)throw new Error(settingError.message);if(!setting)throw new Error("Configuração fiscal não encontrada");
    const [{supabaseAdmin},{encryptIntegrationSecret}]=await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./integration-crypto.server"),
    ]);
    const [pfxEncrypted,passwordEncrypted]=await Promise.all([
      encryptIntegrationSecret(pfxBase64),encryptIntegrationSecret(password),
    ]);
    const secretReference=crypto.randomUUID();const admin=supabaseAdmin as any;
    const {error:vaultError}=await admin.from("fiscal_certificate_secrets").upsert({
      fiscal_setting_id:data.settingId,tenant_id:context.tenantId,secret_reference:secretReference,
      pfx_encrypted:pfxEncrypted,password_encrypted:passwordEncrypted,file_name:fileName,size_bytes:bytes.length,
      uploaded_by:context.userId,uploaded_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    },{onConflict:"fiscal_setting_id"});
    if(vaultError)throw new Error(vaultError.message);
    const details={...((setting as any).homologation_details??{}),certificate:{fileName,sizeBytes:bytes.length,uploadedAt:new Date().toISOString(),validationStatus:"pending"}};
    const {error:updateError}=await admin.from("fiscal_settings").update({certificate_secret_ref:secretReference,
      homologation_status:"certificate_pending_validation",homologation_details:details,transmission_enabled:false,
      updated_by:context.userId}).eq("id",data.settingId).eq("tenant_id",context.tenantId);
    if(updateError)throw new Error(updateError.message);
    return{ok:true,fileName,sizeBytes:bytes.length,status:"pending_validation"};
  });

export const removeFiscalCertificate = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:{settingId:string})=>input)
  .handler(async({data,context})=>{
    const sb=tdb(context.supabase);await requireTenantRole(sb,context.userId,context.tenantId,["owner","admin"]);
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");const admin=supabaseAdmin as any;
    const {data:setting,error:settingError}=await sb.from("fiscal_settings").select("id,homologation_details")
      .eq("id",data.settingId).eq("tenant_id",context.tenantId).maybeSingle();
    if(settingError)throw new Error(settingError.message);if(!setting)throw new Error("Configuração fiscal não encontrada");
    const {error:deleteError}=await admin.from("fiscal_certificate_secrets").delete().eq("fiscal_setting_id",data.settingId).eq("tenant_id",context.tenantId);
    if(deleteError)throw new Error(deleteError.message);
    const details={...((setting as any).homologation_details??{})};delete details.certificate;
    const {error:updateError}=await admin.from("fiscal_settings").update({certificate_secret_ref:null,certificate_expires_at:null,
      homologation_status:"credentials_missing",homologation_details:details,transmission_enabled:false,updated_by:context.userId})
      .eq("id",data.settingId).eq("tenant_id",context.tenantId);
    if(updateError)throw new Error(updateError.message);return{ok:true};
  });

export const saveFiscalProfilesBatch = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:FiscalProfileInput)=>input)
  .handler(async({data,context})=>{
    const sb=tdb(context.supabase);await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_APPROVE_ROLES);
    const digits=(v:string)=>String(v??"").replace(/\D/g,"");
    const ids=[...new Set(data.productIds)].slice(0,200);const ncm=digits(data.ncm);const cest=digits(data.cest??"");
    if(!ids.length)throw new Error("Selecione pelo menos um produto");
    if(!/^\d{8}$/.test(ncm))throw new Error("NCM deve conter exatamente 8 dígitos");
    if(cest&&!/^\d{7}$/.test(cest))throw new Error("CEST deve conter 7 dígitos");
    if(!/^\d{4}$/.test(digits(data.cfopInState))||!/^\d{4}$/.test(digits(data.cfopOutState)))throw new Error("Informe os CFOPs de venda com 4 dígitos");
    if(!Number.isInteger(Number(data.origin))||Number(data.origin)<0||Number(data.origin)>8)throw new Error("Origem da mercadoria inválida");
    const check=await sb.from("products").select("id").eq("tenant_id",context.tenantId).in("id",ids);
    if(check.error)throw new Error(check.error.message);if((check.data??[]).length!==ids.length)throw new Error("Há produto inválido ou fora da empresa");
    const rows=ids.map(productId=>({tenant_id:context.tenantId,product_id:productId,ncm,cest:cest||null,origin:Number(data.origin),
      cfop_in_state:digits(data.cfopInState),cfop_out_state:digits(data.cfopOutState),icms_cst:data.icmsCst?.trim()||null,
      icms_csosn:data.icmsCsosn?.trim()||null,icms_rate:Number(data.icmsRate??0),pis_cst:data.pisCst?.trim()||null,
      pis_rate:Number(data.pisRate??0),cofins_cst:data.cofinsCst?.trim()||null,cofins_rate:Number(data.cofinsRate??0),
      notes:data.notes?.trim()||"Aprovado na fila de saneamento fiscal",created_by:context.userId,updated_by:context.userId,updated_at:new Date().toISOString()}));
    const{error}=await sb.from("product_fiscal_profiles").upsert(rows,{onConflict:"tenant_id,product_id"});if(error)throw new Error(error.message);
    return{ok:true,updated:rows.length};
  });


export const exportFiscalProfiles = createServerFn({method:"GET"}).middleware([requireSupabaseAuth])
  .handler(async({context})=>{
    const sb=tdb(context.supabase);await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_READ_ROLES);
    const [products,profiles]=await Promise.all([
      sb.from("products").select("id,sku,name,internal_code,manufacturer_code,gtin").eq("tenant_id",context.tenantId).eq("active",true).order("name").limit(10000),
      sb.from("product_fiscal_profiles").select("*").eq("tenant_id",context.tenantId),
    ]);
    if(products.error)throw new Error(products.error.message);if(profiles.error)throw new Error(profiles.error.message);
    const byProduct=new Map(((profiles.data??[]) as any[]).map(p=>[p.product_id,p]));
    return ((products.data??[]) as any[]).map(p=>{const f:any=byProduct.get(p.id)??{};return{
      productId:p.id,sku:p.sku??"",name:p.name,internalCode:p.internal_code??"",manufacturerCode:p.manufacturer_code??"",gtin:p.gtin??"",
      ncm:f.ncm??"",cest:f.cest??"",origin:f.origin??0,cfopInState:f.cfop_in_state??"",cfopOutState:f.cfop_out_state??"",
      icmsCst:f.icms_cst??"",icmsCsosn:f.icms_csosn??"",icmsRate:f.icms_rate??0,pisCst:f.pis_cst??"",pisRate:f.pis_rate??0,
      cofinsCst:f.cofins_cst??"",cofinsRate:f.cofins_rate??0,notes:f.notes??""
    }});
  });

export const importFiscalProfiles = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:{rows:FiscalCsvRow[]})=>input)
  .handler(async({data,context})=>{
    const sb=tdb(context.supabase);await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_APPROVE_ROLES);
    const digits=(v:unknown)=>String(v??"").replace(/\D/g,"");const rows=data.rows.slice(0,500);
    if(!rows.length)throw new Error("A planilha não contém linhas para importar");
    const errors:string[]=[];const seen=new Set<string>();
    rows.forEach((r,i)=>{const line=i+2;if(!r.productId||seen.has(r.productId))errors.push(`Linha ${line}: produto ausente ou duplicado`);seen.add(r.productId);
      if(!/^\d{8}$/.test(digits(r.ncm)))errors.push(`Linha ${line}: NCM inválido`);
      if(r.cest&&!/^\d{7}$/.test(digits(r.cest)))errors.push(`Linha ${line}: CEST inválido`);
      if(!/^\d{4}$/.test(digits(r.cfopInState))||!/^\d{4}$/.test(digits(r.cfopOutState)))errors.push(`Linha ${line}: CFOP de venda inválido`);
      if(!Number.isInteger(Number(r.origin))||Number(r.origin)<0||Number(r.origin)>8)errors.push(`Linha ${line}: origem inválida`);
    });
    if(errors.length)throw new Error(errors.slice(0,8).join(" · "));
    const ids=rows.map(r=>r.productId);const check=await sb.from("products").select("id").eq("tenant_id",context.tenantId).in("id",ids);
    if(check.error)throw new Error(check.error.message);if((check.data??[]).length!==ids.length)throw new Error("A planilha contém produto inexistente ou de outra empresa");
    const values=rows.map(r=>({tenant_id:context.tenantId,product_id:r.productId,ncm:digits(r.ncm),cest:digits(r.cest)||null,origin:Number(r.origin),
      cfop_in_state:digits(r.cfopInState),cfop_out_state:digits(r.cfopOutState),icms_cst:r.icmsCst?.trim()||null,icms_csosn:r.icmsCsosn?.trim()||null,
      icms_rate:Number(r.icmsRate??0),pis_cst:r.pisCst?.trim()||null,pis_rate:Number(r.pisRate??0),cofins_cst:r.cofinsCst?.trim()||null,
      cofins_rate:Number(r.cofinsRate??0),notes:r.notes?.trim()||"Importado por planilha fiscal",created_by:context.userId,updated_by:context.userId,updated_at:new Date().toISOString()}));
    const result=await sb.from("product_fiscal_profiles").upsert(values,{onConflict:"tenant_id,product_id"});if(result.error)throw new Error(result.error.message);
    return{ok:true,updated:values.length};
  });


export const runFiscalHomologation = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:{action:"preflight"|"prepare";documentId?:string})=>input)
  .handler(async({data,context})=>{
    const sb=tdb(context.supabase);await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_APPROVE_ROLES);
    const result=await context.supabase.functions.invoke("fiscal-homologation",{body:{tenantId:context.tenantId,action:data.action,documentId:data.documentId}});
    if(result.error)throw new Error(result.error.message);return result.data as any;
  });

export const createFiscalDraft = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:{orderId:string;model:"55"|"65"})=>input)
  .handler(async({data,context}):Promise<FiscalDraftResult>=>{
    const sb=tdb(context.supabase);await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_APPROVE_ROLES);
    const{data:result,error}=await sb.rpc("create_fiscal_draft_from_order",{p_order_id:data.orderId,p_model:data.model});
    if(error)throw new Error(error.message);return result as unknown as FiscalDraftResult;
  });
