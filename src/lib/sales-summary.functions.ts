import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireTenantSalesRole } from "@/lib/auth-guards";

const CLOSED = new Set(["cancelado", "cancelled", "estornado", "refunded", "rascunho", "draft"]);
const PAID_SITE = new Set(["paid", "pago", "processing", "shipped", "delivered", "faturado", "enviado", "entregue"]);
const money = (value: unknown) => Number(value ?? 0);
type Origin = "site" | "ia" | "balcao";
type Sale = { id: string; origin: Origin; createdAt: string; total: number; status: string; customer: string; items: Array<{ name: string; sku?: string; quantity: number; total: number }> };
const active = (status: unknown) => !CLOSED.has(String(status ?? "").toLowerCase());

/** Tenant-scoped read model: orders is the primary sales source. Legacy
 * pos_sales/sales_orders are included only when not yet linked to Order Core. */
export const getSalesSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } = {}) => ({ days: Math.min(365, Math.max(1, Math.trunc(input.days ?? 30))) }))
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase); await requireTenantSalesRole(sb, context.userId, context.tenantId);
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const [orderResult, posLegacyResult, iaLegacyResult] = await Promise.all([
      sb.from("orders")
        .select("id,status,total,customer_name,created_at,channel:sales_channels(code),order_items(name,sku,quantity,total)")
        .eq("tenant_id", context.tenantId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(3000),
      (sb as any).from("pos_sales")
        .select("id,order_id,status,total,created_at,customer:customers(name),items:pos_sale_items(quantity,line_total,product:products(name,sku))")
        .eq("tenant_id", context.tenantId)
        .is("order_id", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000),
      sb.from("sales_orders")
        .select("id,status,total,lead_name,created_at,items")
        .eq("tenant_id", context.tenantId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);
    for (const result of [orderResult, posLegacyResult, iaLegacyResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const unifiedOrders: Sale[] = (orderResult.data ?? [])
      .filter((r: any) => active(r.status))
      .map((r: any) => {
        const code = r.channel?.code ?? "site";
        const origin: Origin = code === "pdv" ? "balcao" : code === "whatsapp" ? "ia" : "site";
        return {
          id:r.id,
          origin,
          createdAt:r.created_at,
          total:money(r.total),
          status:r.status,
          customer:r.customer_name || (origin==="balcao" ? "Consumidor final" : origin==="ia" ? "Cliente WhatsApp" : "Cliente do site"),
          items:(r.order_items??[]).map((i:any)=>({
            name:i.name||"Produto",sku:i.sku,quantity:Number(i.quantity??0),total:money(i.total),
          })),
        };
      });

    const legacyBalcao: Sale[] = (posLegacyResult.data ?? [])
      .filter((r: any) => active(r.status))
      .map((r: any) => ({
        id:r.id,origin:"balcao",createdAt:r.created_at,total:money(r.total),status:r.status,
        customer:r.customer?.name||"Cliente de balcão",
        items:(r.items??[]).map((i:any)=>({
          name:i.product?.name||"Produto",sku:i.product?.sku,quantity:Number(i.quantity??0),total:money(i.line_total),
        })),
      }));

    const legacyIa: Sale[] = (iaLegacyResult.data ?? [])
      .filter((r: any) => active(r.status))
      .map((r: any) => ({
        id:r.id,origin:"ia",createdAt:r.created_at,total:money(r.total),status:r.status,
        customer:r.lead_name||"Cliente atendido pela IA",
        items:Array.isArray(r.items)?r.items.map((i:any)=>({
          name:i.name||i.product_name||"Produto",sku:i.sku,quantity:Number(i.quantity??0),
          total:money(i.total??Number(i.quantity??0)*Number(i.unit_price??0)),
        })):[],
      }));

    const all=[...unifiedOrders,...legacyBalcao,...legacyIa]
      .sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt));
    const site=all.filter((row)=>row.origin==="site");
    const balcao=all.filter((row)=>row.origin==="balcao");
    const ia=all.filter((row)=>row.origin==="ia");
    const origin=(key:Origin)=>{const rows=all.filter(r=>r.origin===key);return{orders:rows.length,gross:rows.reduce((n,r)=>n+r.total,0)}};
    const products=new Map<string,{name:string;sku?:string;quantity:number;revenue:number}>();
    for(const sale of all) for(const item of sale.items){const key=`${item.sku??""}:${item.name}`, current=products.get(key)??{name:item.name,sku:item.sku,quantity:0,revenue:0};current.quantity+=item.quantity;current.revenue+=item.total;products.set(key,current)}
    const siteProducts=new Map<string,{name:string;sku?:string;quantity:number;revenue:number}>();
    for(const sale of site.filter(r=>PAID_SITE.has(String(r.status).toLowerCase())))for(const item of sale.items){
      const key=item.sku??item.name;
      const p=siteProducts.get(key)??{name:item.name,sku:item.sku,quantity:0,revenue:0};
      p.quantity+=item.quantity;p.revenue+=item.total;siteProducts.set(key,p);
    }
    const siteDailyMap=new Map<string,{date:string;orders:number;revenue:number}>();
    for(const sale of site.filter(r=>PAID_SITE.has(String(r.status).toLowerCase()))){
      const date=sale.createdAt.slice(0,10);
      const day=siteDailyMap.get(date)??{date,orders:0,revenue:0};
      day.orders++;day.revenue+=sale.total;siteDailyMap.set(date,day);
    }
    const siteDaily=[...siteDailyMap.values()].sort((a,b)=>a.date.localeCompare(b.date));
    const siteTopProducts=[...siteProducts.values()].sort((a,b)=>b.quantity-a.quantity||b.revenue-a.revenue).slice(0,10);
    const gross=all.reduce((n,r)=>n+r.total,0);
    return {periodDays:data.days,total:{orders:all.length,gross,averageTicket:all.length?gross/all.length:0},origins:{site:origin("site"),ia:origin("ia"),balcao:origin("balcao")},pendingSiteOrders:site.filter(r=>["aguardando_pagamento","pending"].includes(String(r.status).toLowerCase())).length,paidSiteOrders:site.filter(r=>PAID_SITE.has(String(r.status).toLowerCase())).length,siteConfirmedRevenue:site.filter(r=>PAID_SITE.has(String(r.status).toLowerCase())).reduce((n,r)=>n+r.total,0),sitePendingValue:site.filter(r=>["aguardando_pagamento","pending"].includes(String(r.status).toLowerCase())).reduce((n,r)=>n+r.total,0),siteDaily,siteTopProducts,topProducts:[...products.values()].sort((a,b)=>b.quantity-a.quantity||b.revenue-a.revenue).slice(0,10),latestSales:all.slice(0,12)};
  });

export const getSiteSaleAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb=tdb(context.supabase);await requireTenantSalesRole(sb,context.userId,context.tenantId);
    const {data,error}=await (sb as any)
      .from("orders")
      .select("id,total,customer_name,status,created_at,channel:sales_channels!inner(code)")
      .eq("tenant_id",context.tenantId)
      .eq("channel.code","site")
      .in("status",["pago","faturado","enviado","entregue"])
      .order("updated_at",{ascending:false})
      .limit(10);
    if(error)throw new Error(error.message);return data??[];
  });
