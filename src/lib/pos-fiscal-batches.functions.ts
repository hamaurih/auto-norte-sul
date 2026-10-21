import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireTenantRole } from "./auth-guards";

export const listPosFiscalCandidates = createServerFn({method:"GET"})
 .middleware([requireSupabaseAuth])
 .handler(async ({context}) => {
   const db=tdb(context.supabase);
   await requireTenantRole(db,context.userId,context.tenantId,["owner","admin","manager","sales"]);
   const [sales,links]=await Promise.all([
     db.from("pos_sales").select("id,created_at,status,total,customer_id,fiscal_status,fiscal_document_id")
       .eq("tenant_id",context.tenantId).eq("status","paid")
       .order("created_at",{ascending:false}).limit(200),
     db.from("pos_fiscal_batch_sales").select("sale_id")
       .eq("tenant_id",context.tenantId).limit(10000),
   ]);
   if(sales.error)throw new Error(sales.error.message);
   if(links.error)throw new Error(links.error.message);
   const linked=new Set((links.data??[]).map((row:any)=>row.sale_id));
   const candidates=(sales.data??[]).filter((s:any)=>!linked.has(s.id)&&!s.fiscal_document_id&&s.fiscal_status==="pending");
   const ids=[...new Set(candidates.map((s:any)=>s.customer_id).filter(Boolean))];
   const customerNames=new Map<string,string>();
   if(ids.length){
     const customers=await db.from("customers").select("id,name").eq("tenant_id",context.tenantId).in("id",ids);
     if(customers.error)throw new Error(customers.error.message);
     (customers.data??[]).forEach((c:any)=>customerNames.set(c.id,c.name));
   }
   return candidates.map((s:any)=>({...s,customer_name:s.customer_id?customerNames.get(s.customer_id)??"Cliente não localizado":"Consumidor não identificado"}));
 });

export const listPosFiscalBatches = createServerFn({method:"GET"})
 .middleware([requireSupabaseAuth])
 .handler(async ({context})=>{
   const db=tdb(context.supabase);
   await requireTenantRole(db,context.userId,context.tenantId,["owner","admin","manager","sales"]);
   const {data,error}=await db.from("pos_fiscal_batches")
     .select("id,status,customer_id,fiscal_document_id,created_at,created_by,reviewed_at,notes")
     .eq("tenant_id",context.tenantId).order("created_at",{ascending:false}).limit(100);
   if(error)throw new Error(error.message);
   const ids=(data??[]).map((x:any)=>x.id);
   if(!ids.length)return [];
   const links=await db.from("pos_fiscal_batch_sales").select("batch_id,sale_id")
    .eq("tenant_id",context.tenantId).in("batch_id",ids);
   if(links.error)throw new Error(links.error.message);
   return (data??[]).map((b:any)=>({...b,sale_ids:(links.data??[]).filter((x:any)=>x.batch_id===b.id).map((x:any)=>x.sale_id)}));
 });

export const createPosFiscalBatch = createServerFn({method:"POST"})
 .middleware([requireSupabaseAuth])
 .inputValidator((input:{saleIds:string[],notes?:string})=>input)
 .handler(async ({context,data})=>{
   const db=tdb(context.supabase);
   await requireTenantRole(db,context.userId,context.tenantId,["owner","admin","manager","sales"]);
   if(!Array.isArray(data.saleIds)||!data.saleIds.length||data.saleIds.length>100)throw new Error("Selecione entre 1 e 100 recibos");
   const ids=data.saleIds;
   if(ids.some(id=>!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)))throw new Error("Identificador de venda inválido");
   const {data:batch,error}=await db.rpc("create_pos_fiscal_batch",{p_sale_ids:ids,p_notes:data.notes??null});
   if(error)throw new Error(error.message);
   return {id:batch as string};
 });

export const cancelPosFiscalBatch = createServerFn({method:"POST"})
 .middleware([requireSupabaseAuth])
 .inputValidator((input:{batchId:string})=>input)
 .handler(async({context,data})=>{
  const db=tdb(context.supabase);
  await requireTenantRole(db,context.userId,context.tenantId,["owner","admin","manager","sales"]);
  const {data:result,error}=await db.rpc("cancel_pos_fiscal_batch",{p_batch_id:data.batchId});
  if(error)throw new Error(error.message);
  return {ok:result===true};
 });

export const preparePosFiscalDraft = createServerFn({method:"POST"})
 .middleware([requireSupabaseAuth])
 .inputValidator((input:{batchId:string,model:"55"|"65"})=>input)
 .handler(async({context,data})=>{
  const db=tdb(context.supabase);
  await requireTenantRole(db,context.userId,context.tenantId,["owner","admin","manager","sales"]);
  if(!["55","65"].includes(data.model))throw new Error("Modelo inválido");
  const {data:documentId,error}=await db.rpc("prepare_pos_fiscal_batch_draft",{p_batch_id:data.batchId,p_model:data.model});
  if(error)throw new Error(error.message);
  return {documentId:documentId as string};
 });
