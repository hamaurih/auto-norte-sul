import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const paymentSchema=z.enum(["pix","cartao","boleto","faturado_b2b"]);

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
    // Nunca associar um orçamento apenas por e-mail ou semelhança de nome.
    // A titularidade exige o cadastro de cliente vinculado ao usuário autenticado.
    if(customerIds.length===0) return [];
    const select="id,number,title,status,origin,parent_quote_id,document_type,version,subtotal,discount,shipping_amount,total,payment_terms,delivery_terms,valid_until,created_at,updated_at,converted_sales_order_id,customer_id,customer_email,quote_items(id,product_id,sku,name,qty,unit_price,discount,total)";
    const {data:quotes,error:quoteError}=await db.from("quotes")
      .select(select)
      .eq("tenant_id",context.tenantId)
      .in("customer_id",customerIds)
      .is("deleted_at",null)
      .order("created_at",{ascending:false})
      .limit(100);
    if(quoteError) throw new Error(quoteError.message);

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

    const { data: reviewRows, error: reviewError } = await db
      .from("quote_commercial_reviews")
      .select("id,quote_id,offered_quote_id,status,requested_benefit,customer_message,original_total,additional_discount,offered_total,credit_mode,credit_days,manager_note,requested_at,reviewed_at,offer_expires_at,converted_order_id")
      .eq("tenant_id",context.tenantId)
      .in("customer_id",customerIds)
      .order("requested_at",{ascending:false})
      .limit(100);
    if(reviewError) throw new Error(reviewError.message);
    const reviewBySource=new Map<string,any>();
    const reviewByOffer=new Map<string,any>();
    for(const review of reviewRows??[]){
      if(!reviewBySource.has(review.quote_id)) reviewBySource.set(review.quote_id,review);
      if(review.offered_quote_id) reviewByOffer.set(review.offered_quote_id,review);
    }

    const now=Date.now();
    return quotes.map((quote:any)=>{
      const review=reviewBySource.get(quote.id)??reviewByOffer.get(quote.id)??null;
      const isOffer=Boolean(review?.offered_quote_id===quote.id);
      const expired=Boolean(quote.valid_until&&new Date(quote.valid_until).getTime()<now);
      const offerExpired=isOffer&&Boolean(review.offer_expires_at&&new Date(review.offer_expires_at).getTime()<now);
      const familyConverted=review?.status==="converted";
      return {
      ...quote,
      review,
      is_commercial_offer:isOffer,
      approved_credit:isOffer&&review?.status==="offered"&&review?.credit_mode==="invoice"&&!offerExpired,
      order_id:quote.converted_sales_order_id?orderBySalesOrder.get(quote.converted_sales_order_id)??null:null,
      can_buy:["rascunho","enviado","em_negociacao","aprovado"].includes(String(quote.status))
        &&!expired&&!offerExpired&&!familyConverted
        &&(!isOffer||review?.status==="offered"),
      can_request_review:quote.origin==="site"&&!isOffer&&!expired
        &&["rascunho","enviado","em_negociacao","aprovado"].includes(String(quote.status))
        &&!["pending","converted"].includes(String(review?.status))
        &&(review?.status!=="offered"||
          (review?.offer_expires_at&&new Date(review.offer_expires_at).getTime()<now)),
      expired:expired||offerExpired,
    };
    });
  });


const selfServiceQuoteSchema=z.object({
  items:z.array(z.object({
    product_id:z.string().uuid(),
    quantity:z.number().int().min(1).max(1000),
  })).min(1).max(100),
  requestKey:z.string().uuid(),
});

// Qualquer conta de cliente pode gerar orçamento automaticamente a partir
// do carrinho. O banco ignora os preços do navegador e valida tudo de novo.
export const createMyQuoteFromCart=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((input)=>selfServiceQuoteSchema.parse(input))
  .handler(async({data,context})=>{
    const {data:quote,error}=await (supabaseAdmin as any).rpc("internal_create_storefront_quote",{
      p_tenant_id:context.tenantId,
      p_user_id:context.userId,
      p_items:data.items,
      p_request_key:data.requestKey,
    });
    if(error){
      const reason=String(error.message??"");
      if(reason.includes("INSUFFICIENT_STOCK")||reason.includes("estoque insuficiente"))
        throw new Error("Alguma peça não tem estoque suficiente. Atualize o carrinho e tente novamente.");
      if(reason.includes("PRODUCT_NOT_AVAILABLE_ON_SITE")||reason.includes("produto não está disponível"))
        throw new Error("Uma das peças não está disponível para compra no site.");
      if(reason.includes("INVALID_PRODUCT_PRICE")||reason.includes("produto sem preço"))
        throw new Error("Uma das peças está sem preço válido.");
      throw new Error("Não foi possível gerar o orçamento: "+reason);
    }
    if(!quote?.id) throw new Error("O orçamento não retornou seu identificador.");
    return quote as {ok:boolean;reused:boolean;id:string;number:number};
  });

export const convertMyQuoteToPurchase = createServerFn({ method:"POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input)=>z.object({
    quoteId:z.string().uuid(),
    paymentMethod:paymentSchema,
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data:result,error }=await (supabaseAdmin as any).rpc("internal_convert_my_quote_to_storefront_order",{
      p_user_id:context.userId,
      p_quote_id:data.quoteId,
      p_payment_method:data.paymentMethod,
    });
    if(error){
      const msg=String(error.message??"");
      if(msg.includes("INSUFFICIENT_STOCK:")) throw new Error("Estoque insuficiente para um dos itens do orçamento. Atualize o orçamento ou fale com a loja.");
      if(msg.includes("QUOTE_EXPIRED")) throw new Error("Este orçamento venceu e precisa ser atualizado.");
      if(msg.includes("CREDIT_NOT_AUTHORIZED_FOR_QUOTE")) throw new Error("Crédito faturado não foi autorizado para este orçamento.");
      if(msg.includes("CREDIT_TERMS_CHANGED")) throw new Error("As condições de crédito mudaram. Solicite nova análise.");
      if(msg.includes("QUOTE_FAMILY_ALREADY_CONVERTED")) throw new Error("Este orçamento já foi comprado em outra versão.");
      if(msg.includes("QUOTE_OFFER_NOT_AVAILABLE")) throw new Error("A proposta revisada não está mais disponível.");
      if(msg.includes("QUOTE_NOT_AVAILABLE")) throw new Error("Este orçamento não está mais disponível para compra.");
      if(msg.includes("PRODUCT_NOT_AVAILABLE_ON_SITE:")) throw new Error("Um dos produtos não está mais disponível para compra no site.");
      throw new Error(msg);
    }
    return result as {ok:boolean;reused:boolean;order_id:string;sales_order_id:string};
  });
