import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupplyRole, SUPPLY_APPROVE_ROLES, SUPPLY_READ_ROLES } from "./supplies.server";

export type FiscalSettingsInput = {
  id?: string; branchId: string; environment: "homologation" | "production"; provider: string;
  legalName: string; tradeName?: string; taxId: string; stateTaxId: string; taxRegime: string; crt: number;
  state: string; cityCode: string; city: string; zipCode: string; street: string; number: string;
  complement?: string; district: string; phone?: string; email?: string; nfeSeries?: number; nfceSeries?: number;
};

export type FiscalDraftResult = { ok: boolean; reused: boolean; document_id: string; status: string; series?: number; number?: number };

export const getFiscalOverview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb=tdb(context.supabase); await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_READ_ROLES);
    const [settings,documents,branches,paidOrders,profiles,products]=await Promise.all([
      sb.from("fiscal_settings").select("*").eq("tenant_id",context.tenantId).order("created_at").limit(10),
      sb.from("fiscal_documents").select("id,order_id,model,environment,series,number,status,access_key,protocol,issued_at,authorized_at,created_at,recipient_name,totals")
        .eq("tenant_id",context.tenantId).order("created_at",{ascending:false}).limit(100),
      sb.from("branches").select("id,name,code,city,state,is_main,active").eq("tenant_id",context.tenantId).eq("active",true).order("is_main",{ascending:false}),
      sb.from("orders").select("id,status,total,customer_name,customer_document,created_at")
        .eq("tenant_id",context.tenantId).in("status",["pago","faturado","enviado","entregue"]).order("created_at",{ascending:false}).limit(50),
      sb.from("product_fiscal_profiles").select("product_id").eq("tenant_id",context.tenantId),
      sb.from("products").select("id").eq("tenant_id",context.tenantId).eq("active",true).limit(10000),
    ]);
    for(const r of [settings,documents,branches,paidOrders,profiles,products]) if(r.error) throw new Error(r.error.message);
    const docs=(documents.data??[]) as any[]; const documented=new Set(docs.map(d=>d.order_id).filter(Boolean));
    const profiled=new Set(((profiles.data??[]) as any[]).map(p=>p.product_id));
    return { settings:settings.data??[],documents:docs,branches:branches.data??[],
      pendingOrders:((paidOrders.data??[]) as any[]).filter(o=>!documented.has(o.id)),
      missingFiscalProfiles:((products.data??[]) as any[]).filter(p=>!profiled.has(p.id)).length,
      productsCount:(products.data??[]).length };
  });

export const saveFiscalSettings = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:FiscalSettingsInput)=>input).handler(async({data,context})=>{
    const sb=tdb(context.supabase);await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_APPROVE_ROLES);
    const digits=(v:string)=>String(v??"").replace(/\D/g,"");
    if(digits(data.taxId).length!==14)throw new Error("CNPJ deve conter 14 dígitos");
    if(!data.legalName.trim()||!data.stateTaxId.trim())throw new Error("Razão social e inscrição estadual são obrigatórias");
    if(!/^[A-Z]{2}$/.test(data.state.toUpperCase()))throw new Error("UF inválida");
    const row={tenant_id:context.tenantId,branch_id:data.branchId,environment:data.environment,provider:data.provider,
      legal_name:data.legalName.trim(),trade_name:data.tradeName?.trim()||null,tax_id:digits(data.taxId),state_tax_id:data.stateTaxId.trim(),
      tax_regime:data.taxRegime,crt:Number(data.crt),state:data.state.toUpperCase(),city_code:digits(data.cityCode),city:data.city.trim(),
      zip_code:digits(data.zipCode),street:data.street.trim(),number:data.number.trim(),complement:data.complement?.trim()||null,
      district:data.district.trim(),phone:data.phone?.trim()||null,email:data.email?.trim()||null,nfe_series:Number(data.nfeSeries??1),
      nfce_series:Number(data.nfceSeries??1),updated_by:context.userId};
    if(data.id){const{error}=await sb.from("fiscal_settings").update(row).eq("id",data.id).eq("tenant_id",context.tenantId);if(error)throw new Error(error.message);return{ok:true,id:data.id};}
    const{data:created,error}=await sb.from("fiscal_settings").insert({...row,enabled:data.environment==="homologation",created_by:context.userId}).select("id").single();
    if(error)throw new Error(error.message);return{ok:true,id:created.id as string};
  });

export const createFiscalDraft = createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
  .inputValidator((input:{orderId:string;model:"55"|"65"})=>input)
  .handler(async({data,context}):Promise<FiscalDraftResult>=>{
    const sb=tdb(context.supabase);await requireSupplyRole(sb,context.userId,context.tenantId,SUPPLY_APPROVE_ROLES);
    const{data:result,error}=await sb.rpc("create_fiscal_draft_from_order",{p_order_id:data.orderId,p_model:data.model});
    if(error)throw new Error(error.message);return result as unknown as FiscalDraftResult;
  });
