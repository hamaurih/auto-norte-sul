import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireProcurementRole(sb:any,userId:string,tenantId:string,write=false){
  const {data,error}=await sb.from("tenant_memberships").select("role").eq("tenant_id",tenantId).eq("user_id",userId).eq("active",true);
  if(error) throw new Error(error.message);
  const allowed=write?["owner","admin","manager","stock"]:["owner","admin","manager","stock","finance","seller"];
  if(!(data??[]).some((x:any)=>allowed.includes(x.role))) throw new Error("Usuário sem permissão de suprimentos");
}

export const listSupplierReturns=createServerFn({method:"GET"})
.middleware([requireSupabaseAuth])
.handler(async({context})=>{
  const sb=tdb(context.supabase); await requireProcurementRole(sb,context.userId,context.tenantId);
  const [returns,receipts,discrepancies]=await Promise.all([
    (sb as any).from("supplier_returns")
      .select("id,number,status,reason,document_number,total_amount,created_at,confirmed_at,goods_receipt_id,purchase_order_id,supplier:suppliers(id,legal_name,trade_name),warehouse:warehouses(id,name,code)")
      .eq("tenant_id",context.tenantId).order("number",{ascending:false}).limit(300),
    (sb as any).from("goods_receipts")
      .select("id,number,status,received_at,invoice_number,purchase_order_id,supplier_id,warehouse_id,supplier:suppliers(id,legal_name,trade_name),warehouse:warehouses(id,name,code)")
      .eq("tenant_id",context.tenantId).eq("status","confirmed").order("received_at",{ascending:false}).limit(300),
    (sb as any).from("goods_receipt_discrepancies")
      .select("id,goods_receipt_id,goods_receipt_item_id,type,status,expected_value,actual_value,description,resolution_notes,created_at")
      .eq("tenant_id",context.tenantId).order("created_at",{ascending:false}).limit(500),
  ]);
  for(const r of [returns,receipts,discrepancies]) if(r.error) throw new Error(r.error.message);
  return {returns:returns.data??[],receipts:receipts.data??[],discrepancies:discrepancies.data??[]};
});

export const getReturnableReceipt=createServerFn({method:"GET"})
.middleware([requireSupabaseAuth])
.inputValidator(v=>z.object({receiptId:z.string().uuid()}).parse(v))
.handler(async({data,context})=>{
  const sb=tdb(context.supabase); await requireProcurementRole(sb,context.userId,context.tenantId);
  const {data:receipt,error}=await (sb as any).from("goods_receipts")
    .select("id,number,status,received_at,invoice_number,purchase_order_id,supplier_id,warehouse_id,supplier:suppliers(id,legal_name,trade_name),warehouse:warehouses(id,name,code)")
    .eq("tenant_id",context.tenantId).eq("id",data.receiptId).maybeSingle();
  if(error) throw new Error(error.message); if(!receipt) throw new Error("Recebimento não encontrado");
  if(receipt.status!=="confirmed") throw new Error("Apenas recebimentos confirmados aceitam devolução");
  const [{data:items,error:itemsError},{data:already,error:alreadyError}]=await Promise.all([
    (sb as any).from("goods_receipt_items")
      .select("id,product_id,accepted_qty,unit_cost,acquisition_unit_cost,product:products(id,sku,name,internal_code)")
      .eq("tenant_id",context.tenantId).eq("goods_receipt_id",data.receiptId).order("created_at"),
    (sb as any).from("supplier_return_items")
      .select("goods_receipt_item_id,quantity,supplier_return:supplier_returns!inner(status)")
      .eq("tenant_id",context.tenantId).not("goods_receipt_item_id","is",null),
  ]);
  if(itemsError) throw new Error(itemsError.message); if(alreadyError) throw new Error(alreadyError.message);
  const used=new Map<string,number>();
  for(const x of already??[]){
    const status=(x as any).supplier_return?.status;
    if(status==="draft"||status==="confirmed") used.set(x.goods_receipt_item_id,(used.get(x.goods_receipt_item_id)??0)+Number(x.quantity??0));
  }
  return {receipt,items:(items??[]).map((x:any)=>({...x,returnable_qty:Math.max(0,Math.floor(Number(x.accepted_qty??0)-(used.get(x.id)??0)))}))};
});

const saveSchema=z.object({
  id:z.string().uuid().optional(),
  goods_receipt_id:z.string().uuid(),
  reason:z.string().trim().min(3).max(500),
  document_number:z.string().trim().max(120).optional(),
  notes:z.string().trim().max(2000).optional(),
  items:z.array(z.object({
    goods_receipt_item_id:z.string().uuid(),
    product_id:z.string().uuid(),
    quantity:z.number().int().positive(),
    unit_cost:z.number().min(0),
    reason:z.string().trim().max(500).optional(),
  })).min(1),
});
export const saveSupplierReturn=createServerFn({method:"POST"})
.middleware([requireSupabaseAuth])
.inputValidator(v=>saveSchema.parse(v))
.handler(async({data,context})=>{
  const sb=tdb(context.supabase); await requireProcurementRole(sb,context.userId,context.tenantId,true);
  const {data:receipt,error:receiptError}=await (sb as any).from("goods_receipts")
    .select("id,status,supplier_id,warehouse_id,purchase_order_id")
    .eq("tenant_id",context.tenantId).eq("id",data.goods_receipt_id).maybeSingle();
  if(receiptError) throw new Error(receiptError.message); if(!receipt||receipt.status!=="confirmed") throw new Error("Recebimento confirmado não encontrado");

  const ids=data.items.map(x=>x.goods_receipt_item_id);
  const {data:sourceItems,error:sourceError}=await (sb as any).from("goods_receipt_items")
    .select("id,product_id,accepted_qty").eq("tenant_id",context.tenantId).eq("goods_receipt_id",receipt.id).in("id",ids);
  if(sourceError) throw new Error(sourceError.message);
  const source=new Map((sourceItems??[]).map((x:any)=>[x.id,x]));
  for(const item of data.items){
    const original:any=source.get(item.goods_receipt_item_id);
    if(!original||original.product_id!==item.product_id) throw new Error("Item não pertence ao recebimento selecionado");
    if(item.quantity>Math.floor(Number(original.accepted_qty??0))) throw new Error("Quantidade de devolução supera a quantidade recebida");
  }

  let returnId=data.id;
  if(returnId){
    const {data:current,error}=await (sb as any).from("supplier_returns").select("id,status").eq("tenant_id",context.tenantId).eq("id",returnId).maybeSingle();
    if(error) throw new Error(error.message); if(!current||current.status!=="draft") throw new Error("Somente devolução em rascunho pode ser editada");
    const {error:updateError}=await (sb as any).from("supplier_returns").update({reason:data.reason,document_number:data.document_number||null,notes:data.notes||null,updated_by:context.userId,updated_at:new Date().toISOString()}).eq("id",returnId).eq("tenant_id",context.tenantId);
    if(updateError) throw new Error(updateError.message);
    const {error:deleteError}=await (sb as any).from("supplier_return_items").delete().eq("tenant_id",context.tenantId).eq("supplier_return_id",returnId);
    if(deleteError) throw new Error(deleteError.message);
  }else{
    const {data:created,error}=await (sb as any).from("supplier_returns").insert({
      tenant_id:context.tenantId,supplier_id:receipt.supplier_id,warehouse_id:receipt.warehouse_id,
      goods_receipt_id:receipt.id,purchase_order_id:receipt.purchase_order_id??null,status:"draft",
      reason:data.reason,document_number:data.document_number||null,notes:data.notes||null,
      created_by:context.userId,updated_by:context.userId,
    }).select("id").single();
    if(error) throw new Error(error.message); returnId=created.id;
  }
  const rows=data.items.map(item=>({
    tenant_id:context.tenantId,supplier_return_id:returnId,product_id:item.product_id,
    goods_receipt_item_id:item.goods_receipt_item_id,quantity:item.quantity,unit_cost:item.unit_cost,
    line_total:Math.round(item.quantity*item.unit_cost*100)/100,reason:item.reason||null,
  }));
  const {error:itemsError}=await (sb as any).from("supplier_return_items").insert(rows);
  if(itemsError) throw new Error(itemsError.message);
  const total=rows.reduce((s,x)=>s+x.line_total,0);
  const {error:totalError}=await (sb as any).from("supplier_returns").update({total_amount:Math.round(total*100)/100,updated_by:context.userId,updated_at:new Date().toISOString()}).eq("id",returnId).eq("tenant_id",context.tenantId);
  if(totalError) throw new Error(totalError.message);
  return {ok:true,id:returnId,total};
});

export const confirmSupplierReturn=createServerFn({method:"POST"})
.middleware([requireSupabaseAuth])
.inputValidator(v=>z.object({id:z.string().uuid()}).parse(v))
.handler(async({data,context})=>{
  const sb=tdb(context.supabase); await requireProcurementRole(sb,context.userId,context.tenantId,true);
  const {data:row,error}=await (sb as any).from("supplier_returns").select("id,tenant_id").eq("tenant_id",context.tenantId).eq("id",data.id).maybeSingle();
  if(error) throw new Error(error.message); if(!row) throw new Error("Devolução não encontrada");
  const {data:result,error:rpcError}=await (supabaseAdmin as any).rpc("confirm_supplier_return",{p_return_id:data.id,p_actor_user_id:context.userId});
  if(rpcError) throw new Error(rpcError.message);
  return result;
});

export const resolveReceiptDiscrepancy=createServerFn({method:"POST"})
.middleware([requireSupabaseAuth])
.inputValidator(v=>z.object({id:z.string().uuid(),status:z.enum(["resolved","waived"]),notes:z.string().trim().min(3).max(2000)}).parse(v))
.handler(async({data,context})=>{
  const sb=tdb(context.supabase); await requireProcurementRole(sb,context.userId,context.tenantId,true);
  const {data:row,error}=await (sb as any).from("goods_receipt_discrepancies").update({
    status:data.status,resolution_notes:data.notes,resolved_at:new Date().toISOString(),resolved_by:context.userId,
  }).eq("tenant_id",context.tenantId).eq("id",data.id).eq("status","open").select("id").maybeSingle();
  if(error) throw new Error(error.message); if(!row) throw new Error("Divergência já tratada ou não encontrada");
  return {ok:true};
});
