import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireQuotationRole(sb:any,userId:string,tenantId:string,write=false){
  const {data,error}=await sb.from("tenant_memberships").select("role").eq("tenant_id",tenantId).eq("user_id",userId).eq("active",true);
  if(error) throw new Error(error.message);
  const allowed=write?["owner","admin","manager","stock"]:["owner","admin","manager","stock","finance","seller"];
  if(!(data??[]).some((x:any)=>allowed.includes(x.role))) throw new Error("Usuário sem permissão de compras");
}

export const listPurchaseQuotations=createServerFn({method:"GET"})
.middleware([requireSupabaseAuth])
.handler(async({context})=>{
  const sb=tdb(context.supabase); await requireQuotationRole(sb,context.userId,context.tenantId);
  const {data,error}=await (sb as any).from("purchase_quotations")
    .select("id,number,status,title,requested_by_date,created_at,purchase_order_id,warehouse:warehouses(id,name,code)")
    .eq("tenant_id",context.tenantId).order("number",{ascending:false}).limit(300);
  if(error) throw new Error(error.message);
  return data??[];
});

export const getPurchaseQuotation=createServerFn({method:"GET"})
.middleware([requireSupabaseAuth])
.inputValidator(v=>z.object({id:z.string().uuid()}).parse(v))
.handler(async({data,context})=>{
  const sb=tdb(context.supabase); await requireQuotationRole(sb,context.userId,context.tenantId);
  const [quotation,items,quotes]=await Promise.all([
    (sb as any).from("purchase_quotations")
      .select("id,number,status,title,requested_by_date,notes,warehouse_id,selected_supplier_quote_id,purchase_order_id,converted_at,warehouse:warehouses(id,name,code)")
      .eq("tenant_id",context.tenantId).eq("id",data.id).maybeSingle(),
    (sb as any).from("purchase_quotation_items")
      .select("id,product_id,requested_qty,notes,product:products(id,sku,name,internal_code,last_purchase_cost,average_cost)")
      .eq("tenant_id",context.tenantId).eq("quotation_id",data.id).order("created_at"),
    (sb as any).from("supplier_quotes")
      .select("id,supplier_id,status,payment_terms,delivery_days,freight_amount,discount_amount,other_amount,items_total,total_amount,valid_until,notes,submitted_at,supplier:suppliers(id,legal_name,trade_name,average_lead_days,payment_terms)")
      .eq("tenant_id",context.tenantId).eq("quotation_id",data.id).order("total_amount"),
  ]);
  if(quotation.error) throw new Error(quotation.error.message);
  if(!quotation.data) throw new Error("Cotação não encontrada");
  if(items.error) throw new Error(items.error.message);
  if(quotes.error) throw new Error(quotes.error.message);
  const quoteIds=(quotes.data??[]).map((x:any)=>x.id);
  let quoteItems:any[]=[];
  if(quoteIds.length){
    const r=await (sb as any).from("supplier_quote_items")
      .select("id,supplier_quote_id,quotation_item_id,product_id,offered_qty,unit_cost,line_total,notes")
      .eq("tenant_id",context.tenantId).in("supplier_quote_id",quoteIds);
    if(r.error) throw new Error(r.error.message); quoteItems=r.data??[];
  }
  return {quotation:quotation.data,items:items.data??[],quotes:quotes.data??[],quoteItems};
});

const quotationSchema=z.object({
  id:z.string().uuid().optional(),
  warehouse_id:z.string().uuid(),
  title:z.string().trim().min(3).max(180),
  requested_by_date:z.union([z.string().date(),z.literal(""),z.null()]).optional(),
  notes:z.string().trim().max(2000).optional(),
  items:z.array(z.object({
    product_id:z.string().uuid(),
    requested_qty:z.number().positive(),
    notes:z.string().trim().max(500).optional(),
  })).min(1),
});
export const savePurchaseQuotation=createServerFn({method:"POST"})
.middleware([requireSupabaseAuth])
.inputValidator(v=>quotationSchema.parse(v))
.handler(async({data,context})=>{
  const sb=tdb(context.supabase); await requireQuotationRole(sb,context.userId,context.tenantId,true);
  if(new Set(data.items.map(x=>x.product_id)).size!==data.items.length) throw new Error("Não repita o mesmo produto na cotação");
  const {data:warehouse,error:warehouseError}=await sb.from("warehouses").select("id").eq("tenant_id",context.tenantId).eq("id",data.warehouse_id).eq("active",true).maybeSingle();
  if(warehouseError) throw new Error(warehouseError.message); if(!warehouse) throw new Error("Depósito inválido");
  let id=data.id;
  if(id){
    const {data:current,error}=await (sb as any).from("purchase_quotations").select("id,status").eq("tenant_id",context.tenantId).eq("id",id).maybeSingle();
    if(error) throw new Error(error.message); if(!current||current.status!=="draft") throw new Error("Somente cotação em rascunho pode ser editada");
    const {error:updateError}=await (sb as any).from("purchase_quotations").update({
      warehouse_id:data.warehouse_id,title:data.title,requested_by_date:data.requested_by_date||null,notes:data.notes||null,
      updated_by:context.userId,updated_at:new Date().toISOString(),
    }).eq("tenant_id",context.tenantId).eq("id",id);
    if(updateError) throw new Error(updateError.message);
    const {error:deleteError}=await (sb as any).from("purchase_quotation_items").delete().eq("tenant_id",context.tenantId).eq("quotation_id",id);
    if(deleteError) throw new Error(deleteError.message);
  }else{
    const {data:created,error}=await (sb as any).from("purchase_quotations").insert({
      tenant_id:context.tenantId,warehouse_id:data.warehouse_id,title:data.title,
      requested_by_date:data.requested_by_date||null,notes:data.notes||null,status:"draft",
      created_by:context.userId,updated_by:context.userId,
    }).select("id").single();
    if(error) throw new Error(error.message); id=created.id;
  }
  const {error:itemsError}=await (sb as any).from("purchase_quotation_items").insert(data.items.map(x=>({
    tenant_id:context.tenantId,quotation_id:id,product_id:x.product_id,requested_qty:x.requested_qty,notes:x.notes||null,
  })));
  if(itemsError) throw new Error(itemsError.message);
  return {ok:true,id};
});

export const openPurchaseQuotation=createServerFn({method:"POST"})
.middleware([requireSupabaseAuth])
.inputValidator(v=>z.object({id:z.string().uuid()}).parse(v))
.handler(async({data,context})=>{
  const sb=tdb(context.supabase); await requireQuotationRole(sb,context.userId,context.tenantId,true);
  const {data:row,error}=await (sb as any).from("purchase_quotations").update({status:"open",updated_by:context.userId,updated_at:new Date().toISOString()})
    .eq("tenant_id",context.tenantId).eq("id",data.id).eq("status","draft").select("id").maybeSingle();
  if(error) throw new Error(error.message); if(!row) throw new Error("Cotação não está em rascunho");
  return {ok:true};
});

const supplierQuoteSchema=z.object({
  quotation_id:z.string().uuid(),
  supplier_id:z.string().uuid(),
  payment_terms:z.string().trim().max(300).optional(),
  delivery_days:z.number().int().min(0).max(365).optional(),
  freight_amount:z.number().min(0).default(0),
  discount_amount:z.number().min(0).default(0),
  other_amount:z.number().min(0).default(0),
  valid_until:z.union([z.string().date(),z.literal(""),z.null()]).optional(),
  notes:z.string().trim().max(2000).optional(),
  items:z.array(z.object({
    quotation_item_id:z.string().uuid(),
    product_id:z.string().uuid(),
    offered_qty:z.number().min(0),
    unit_cost:z.number().min(0),
    notes:z.string().trim().max(500).optional(),
  })).min(1),
});
export const saveSupplierQuote=createServerFn({method:"POST"})
.middleware([requireSupabaseAuth])
.inputValidator(v=>supplierQuoteSchema.parse(v))
.handler(async({data,context})=>{
  const sb=tdb(context.supabase); await requireQuotationRole(sb,context.userId,context.tenantId,true);
  const [{data:quotation,error:qError},{data:supplier,error:sError},{data:qItems,error:iError}]=await Promise.all([
    (sb as any).from("purchase_quotations").select("id,status").eq("tenant_id",context.tenantId).eq("id",data.quotation_id).maybeSingle(),
    sb.from("suppliers").select("id").eq("tenant_id",context.tenantId).eq("id",data.supplier_id).eq("active",true).maybeSingle(),
    (sb as any).from("purchase_quotation_items").select("id,product_id,requested_qty").eq("tenant_id",context.tenantId).eq("quotation_id",data.quotation_id),
  ]);
  if(qError) throw new Error(qError.message); if(!quotation||!["draft","open","awarded"].includes(quotation.status)) throw new Error("Cotação não aceita propostas");
  if(sError) throw new Error(sError.message); if(!supplier) throw new Error("Fornecedor inválido");
  if(iError) throw new Error(iError.message);
  const expected=new Map((qItems??[]).map((x:any)=>[x.id,x]));
  for(const x of data.items){
    const q:any=expected.get(x.quotation_item_id);
    if(!q||q.product_id!==x.product_id) throw new Error("Item da proposta não pertence à cotação");
  }
  const itemsTotal=Math.round(data.items.reduce((s,x)=>s+x.offered_qty*x.unit_cost,0)*100)/100;
  const total=Math.max(0,Math.round((itemsTotal+data.freight_amount+data.other_amount-data.discount_amount)*100)/100);
  const {data:existing,error:eError}=await (sb as any).from("supplier_quotes").select("id,status")
    .eq("tenant_id",context.tenantId).eq("quotation_id",data.quotation_id).eq("supplier_id",data.supplier_id).maybeSingle();
  if(eError) throw new Error(eError.message);
  let quoteId=existing?.id;
  const payload={
    payment_terms:data.payment_terms||null,delivery_days:data.delivery_days??null,freight_amount:data.freight_amount,
    discount_amount:data.discount_amount,other_amount:data.other_amount,items_total:itemsTotal,total_amount:total,
    valid_until:data.valid_until||null,notes:data.notes||null,status:"submitted",submitted_at:new Date().toISOString(),
    updated_by:context.userId,updated_at:new Date().toISOString(),
  };
  if(quoteId){
    if(existing.status==="selected") throw new Error("Proposta selecionada não pode ser editada");
    const {error}=await (sb as any).from("supplier_quotes").update(payload).eq("tenant_id",context.tenantId).eq("id",quoteId);
    if(error) throw new Error(error.message);
    const {error:deleteError}=await (sb as any).from("supplier_quote_items").delete().eq("tenant_id",context.tenantId).eq("supplier_quote_id",quoteId);
    if(deleteError) throw new Error(deleteError.message);
  }else{
    const {data:created,error}=await (sb as any).from("supplier_quotes").insert({
      tenant_id:context.tenantId,quotation_id:data.quotation_id,supplier_id:data.supplier_id,...payload,created_by:context.userId,
    }).select("id").single();
    if(error) throw new Error(error.message); quoteId=created.id;
  }
  const {error:lineError}=await (sb as any).from("supplier_quote_items").insert(data.items.map(x=>({
    tenant_id:context.tenantId,supplier_quote_id:quoteId,quotation_item_id:x.quotation_item_id,product_id:x.product_id,
    offered_qty:x.offered_qty,unit_cost:x.unit_cost,line_total:Math.round(x.offered_qty*x.unit_cost*100)/100,notes:x.notes||null,
  })));
  if(lineError) throw new Error(lineError.message);
  if(quotation.status==="draft"){
    await (sb as any).from("purchase_quotations").update({status:"open",updated_by:context.userId,updated_at:new Date().toISOString()}).eq("id",data.quotation_id).eq("tenant_id",context.tenantId);
  }
  return {ok:true,id:quoteId,total};
});

export const convertSupplierQuoteToPurchaseOrder=createServerFn({method:"POST"})
.middleware([requireSupabaseAuth])
.inputValidator(v=>z.object({supplierQuoteId:z.string().uuid()}).parse(v))
.handler(async({data,context})=>{
  const sb=tdb(context.supabase); await requireQuotationRole(sb,context.userId,context.tenantId,true);
  const {data:quote,error}=await (sb as any).from("supplier_quotes").select("id,tenant_id").eq("tenant_id",context.tenantId).eq("id",data.supplierQuoteId).maybeSingle();
  if(error) throw new Error(error.message); if(!quote) throw new Error("Proposta não encontrada");
  const {data:result,error:rpcError}=await (supabaseAdmin as any).rpc("convert_supplier_quote_to_purchase_order",{p_supplier_quote_id:data.supplierQuoteId,p_actor_user_id:context.userId});
  if(rpcError) throw new Error(rpcError.message);
  return result;
});
