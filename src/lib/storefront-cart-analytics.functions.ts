import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantSalesRole } from "@/lib/auth-guards";
import { tdb } from "@/integrations/supabase/tenant-db";

const eventSchema=z.object({
  storefrontSlug:z.string().regex(/^[a-z0-9-]{2,80}$/),
  sessionId:z.string().uuid(),
  event:z.enum(["cart_updated","checkout_started","order_submitted","cleared"]),
  itemsCount:z.number().int().min(0).max(10000),
  estimatedTotal:z.number().finite().min(0).max(100000000),
  consent:z.literal(true),
});
/** First-party, consent-based, no PII and no payment or product identifiers. */
export const recordStorefrontCart=createServerFn({method:"POST"})
  .inputValidator((input:unknown)=>eventSchema.parse(input))
  .handler(async({data})=>{
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const sb=supabaseAdmin as any;
    const {data:store,error:storeError}=await sb.from("tenant_storefronts")
      .select("tenant_id").eq("slug",data.storefrontSlug).eq("active",true).maybeSingle();
    if(storeError||!store?.tenant_id) return {ok:false};
    const {data:existing,error:existingError}=await sb.from("storefront_cart_sessions")
      .select("last_event,checkout_started_at,order_submitted_at,recovered_at,items_count,updated_at")
      .eq("tenant_id",store.tenant_id).eq("session_id",data.sessionId).maybeSingle();
    if(existingError) throw new Error("Erro ao verificar carrinho");
    // One write per 3 seconds; cap abuse from anonymous callers.
    if(existing && data.event==="cart_updated" && Date.now()-new Date(existing.updated_at).getTime()<3000) return {ok:true,throttled:true};
    const terminal=existing?.last_event==="order_submitted";
    if(terminal) return {ok:true,terminal:true};
    const event=data.event;
    const payload={
      tenant_id:store.tenant_id,session_id:data.sessionId,
      items_count:data.itemsCount,estimated_total:Number(data.estimatedTotal.toFixed(2)),
      last_event:event,updated_at:new Date().toISOString(),
      checkout_started_at:event==="checkout_started"?new Date().toISOString():existing?.checkout_started_at??null,
      order_submitted_at:event==="order_submitted"?new Date().toISOString():existing?.order_submitted_at??null,
      recovered_at:existing?.recovered_at??(existing?.items_count>0 && event==="cart_updated" && Date.now()-new Date(existing.updated_at).getTime()>30*60000 ? new Date().toISOString() : null),
    };
    const {error}=await sb.from("storefront_cart_sessions").upsert(payload,{onConflict:"tenant_id,session_id"});
    if(error) throw new Error("Erro ao registrar atividade do carrinho");
    return {ok:true};
  });

export const getStorefrontCartAnalytics=createServerFn({method:"GET"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input:{days?:number}={})=>({days:Math.max(1,Math.min(90,Math.trunc(input.days??30)))}))
  .handler(async({data,context})=>{
    await requireTenantSalesRole(tdb(context.supabase),context.userId,context.tenantId);
    const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
    const since=new Date(Date.now()-data.days*86400000).toISOString();
    const {data:rows,error}=await (supabaseAdmin as any).from("storefront_cart_sessions")
      .select("items_count,estimated_total,last_event,checkout_started_at,order_submitted_at,recovered_at,updated_at")
      .eq("tenant_id",context.tenantId).gte("created_at",since)
      .order("created_at",{ascending:false}).limit(10000);
    if(error) throw new Error("Não foi possível carregar métricas do carrinho");
    const now=Date.now();
    const carts=rows??[];
    const abandoned=carts.filter((x:any)=>x.last_event!=="order_submitted"&&x.last_event!=="cleared"&&x.items_count>0&&now-new Date(x.updated_at).getTime()>=30*60000);
    const submitted=carts.filter((x:any)=>x.last_event==="order_submitted");
    const started=carts.filter((x:any)=>x.checkout_started_at);
    return {days:data.days,sessions:carts.length,checkoutStarted:started.length,ordersSubmitted:submitted.length,reactivated:carts.filter((x:any)=>x.recovered_at).length,
      abandoned:abandoned.length,abandonedEstimatedTotal:abandoned.reduce((n:number,x:any)=>n+Number(x.estimated_total??0),0),
      sampled:carts.length===10000, definition:"Abandonado: carrinho consentido com itens, sem pedido enviado e inativo há pelo menos 30 minutos. Valor estimado, não receita."};
  });
