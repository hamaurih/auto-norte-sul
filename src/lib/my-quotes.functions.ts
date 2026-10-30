import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const paymentSchema=z.enum(["pix","cartao","boleto"]);

export const getMyQuotes = createServerFn({ method:"GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db=supabaseAdmin as any;
    const { data:customers,error:customerError }=await db.from("customers")
      .select("id")
      .eq("tenant_id",context.tenantId)
      .eq("user_id",context.userId)
      .eq("active",true);
    if(customerError) throw new Error(customerError.message);
    const customerIds=(customers??[]).map((row:any)=>row.id);
    const { data:authUser,error:authError }=await supabaseAdmin.auth.admin.getUserById(context.userId);
    if(authError) throw new Error(authError.message);
    const authEmail=authUser.user?.email?.trim().toLowerCase()??null;

    const select="id,number,title,status,document_type,version,subtotal,discount,shipping_amount,total,payment_terms,delivery_terms,valid_until,created_at,updated_at,converted_sales_order_id,customer_id,customer_email,quote_items(id,product_id,sku,name,qty,unit_price,discount,total)";
    const queries:Promise<any>[]=[];
    if(customerIds.length){
      queries.push(db.from("quotes")
        .select(select)
        .eq("tenant_id",context.tenantId)
        .in("customer_id",customerIds)
        .is("deleted_at",null)
        .order("created_at",{ascending:false})
        .limit(100));
    }
    if(authEmail){
      queries.push(db.from("quotes")
        .select(select)
        .eq("tenant_id",context.tenantId)
        .is("customer_id",null)
        .ilike("customer_email",authEmail)
        .is("deleted_at",null)
        .order("created_at",{ascending:false})
        .limit(100));
    }
    if(!queries.length) return [];

    const results=await Promise.all(queries);
    const byId=new Map<string,any>();
    for(const result of results){
      if(result.error) throw new Error(result.error.message);
      for(const quote of result.data??[]) byId.set(quote.id,quote);
    }
    const quotes=[...byId.values()].sort((a:any,b:any)=>+new Date(b.created_at)-+new Date(a.created_at)).slice(0,100);

    const salesOrderIds=quotes.map((q:any)=>q.converted_sales_order_id).filter(Boolean);
    const orderBySalesOrder=new Map<string,string>();
    if(salesOrderIds.length){
      const { data:salesOrders,error:salesError }=await db.from("sales_orders")
        .select("id,order_id")
        .eq("tenant_id",context.tenantId)
        .in("id",salesOrderIds);
      if(salesError) throw new Error(salesError.message);
      for(const row of salesOrders??[]) if(row.order_id) orderBySalesOrder.set(row.id,row.order_id);
    }

    const now=Date.now();
    return quotes.map((quote:any)=>({
      ...quote,
      order_id:quote.converted_sales_order_id?orderBySalesOrder.get(quote.converted_sales_order_id)??null:null,
      can_buy:["enviado","aprovado"].includes(String(quote.status))
        && (!quote.valid_until || new Date(quote.valid_until).getTime()>=now),
      expired:Boolean(quote.valid_until && new Date(quote.valid_until).getTime()<now),
    }));
  });

export const convertMyQuoteToPurchase = createServerFn({ method:"POST" })
  .middleware([requireSupabaseAuth])
  .validator((input)=>z.object({
    quoteId:z.string().uuid(),
    paymentMethod:paymentSchema,
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data:result,error }=await (context.supabase as any).rpc("convert_my_quote_to_storefront_order",{
      p_quote_id:data.quoteId,
      p_payment_method:data.paymentMethod,
    });
    if(error){
      const msg=String(error.message??"");
      if(msg.includes("INSUFFICIENT_STOCK:")) throw new Error("Estoque insuficiente para um dos itens do orçamento. Atualize o orçamento ou fale com a loja.");
      if(msg.includes("QUOTE_EXPIRED")) throw new Error("Este orçamento venceu e precisa ser atualizado.");
      if(msg.includes("QUOTE_NOT_RELEASED")) throw new Error("Este orçamento ainda não está liberado para compra.");
      if(msg.includes("PRODUCT_NOT_AVAILABLE_ON_SITE:")) throw new Error("Um dos produtos não está mais disponível para compra no site.");
      throw new Error(msg);
    }
    return result as {ok:boolean;reused:boolean;order_id:string;sales_order_id:string};
  });
