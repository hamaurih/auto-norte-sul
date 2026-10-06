import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireTenantSalesRole } from "@/lib/auth-guards";

const CLOSED = new Set(["cancelado", "cancelled", "estornado", "refunded", "rascunho", "draft"]);
const PAID_SITE = new Set(["pago", "faturado", "enviado", "entregue"]);
const money = (value: unknown) => Number(value ?? 0);
type Origin = "site" | "ia" | "balcao";
type Sale = { id: string; origin: Origin; createdAt: string; total: number; status: string; customer: string; items: Array<{ name: string; sku?: string; quantity: number; total: number }> };
const active = (status: unknown) => !CLOSED.has(String(status ?? "").toLowerCase());

/** Tenant-scoped read model: site checkout, sales IA and POS are consolidated
 * only for reporting; source records and financial values are never altered. */
export const getSalesSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } = {}) => ({ days: Math.min(365, Math.max(1, Math.trunc(input.days ?? 30))) }))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase); await requireTenantSalesRole(sb, context.userId, context.tenantId);
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const [siteResult, posResult, iaResult] = await Promise.all([
      sb.from("orders").select("id,status,total,customer_name,created_at,order_items(name,sku,quantity,total)").eq("tenant_id", context.tenantId).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
      sb.from("pos_sales").select("id,status,total,created_at,customer:customers(name),items:pos_sale_items(quantity,line_total,product:products(name,sku))").eq("tenant_id", context.tenantId).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
      sb.from("sales_orders").select("id,status,total,lead_name,created_at,items").eq("tenant_id", context.tenantId).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
    ]);
    for (const result of [siteResult, posResult, iaResult]) if (result.error) throw new Error(result.error.message);
    const site: Sale[] = (siteResult.data ?? []).filter((r: any) => active(r.status)).map((r: any) => ({ id:r.id,origin:"site",createdAt:r.created_at,total:money(r.total),status:r.status,customer:r.customer_name||"Cliente do site",items:(r.order_items??[]).map((i:any)=>({name:i.name||"Produto",sku:i.sku,quantity:Number(i.quantity??0),total:money(i.total)})) }));
    const balcao: Sale[] = (posResult.data ?? []).filter((r: any) => active(r.status)).map((r: any) => ({ id:r.id,origin:"balcao",createdAt:r.created_at,total:money(r.total),status:r.status,customer:r.customer?.name||"Cliente de balcão",items:(r.items??[]).map((i:any)=>({name:i.product?.name||"Produto",sku:i.product?.sku,quantity:Number(i.quantity??0),total:money(i.line_total)})) }));
    const ia: Sale[] = (iaResult.data ?? []).filter((r: any) => active(r.status)).map((r: any) => ({ id:r.id,origin:"ia",createdAt:r.created_at,total:money(r.total),status:r.status,customer:r.lead_name||"Cliente atendido pela IA",items:Array.isArray(r.items)?r.items.map((i:any)=>({name:i.name||i.product_name||"Produto",sku:i.sku,quantity:Number(i.quantity??0),total:money(i.total??Number(i.quantity??0)*Number(i.unit_price??0))})):[] }));
    const all=[...site,...balcao,...ia].sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt));
    const origin=(key:Origin)=>{const rows=all.filter(r=>r.origin===key);return{orders:rows.length,gross:rows.reduce((n,r)=>n+r.total,0)}};
    const products=new Map<string,{name:string;sku?:string;quantity:number;revenue:number}>();
    for(const sale of all) for(const item of sale.items){const key=`${item.sku??""}:${item.name}`, current=products.get(key)??{name:item.name,sku:item.sku,quantity:0,revenue:0};current.quantity+=item.quantity;current.revenue+=item.total;products.set(key,current)}
    const gross=all.reduce((n,r)=>n+r.total,0);
    return {periodDays:data.days,total:{orders:all.length,gross,averageTicket:all.length?gross/all.length:0},origins:{site:origin("site"),ia:origin("ia"),balcao:origin("balcao")},pendingSiteOrders:site.filter(r=>String(r.status).toLowerCase()==="aguardando_pagamento").length,paidSiteOrders:site.filter(r=>PAID_SITE.has(String(r.status).toLowerCase())).length,topProducts:[...products.values()].sort((a,b)=>b.quantity-a.quantity||b.revenue-a.revenue).slice(0,10),latestSales:all.slice(0,12)};
  });

export const getSiteSaleAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb=tdb(context.supabase);await requireTenantSalesRole(sb,context.userId,context.tenantId);
    const {data,error}=await sb.from("orders").select("id,total,customer_name,status,created_at").eq("tenant_id",context.tenantId).in("status",["pago","faturado","enviado","entregue"]).order("updated_at",{ascending:false}).limit(10);
    if(error)throw new Error(error.message);return data??[];
  });
