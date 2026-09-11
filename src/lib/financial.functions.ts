import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

async function financeRoles(sb: any, userId: string, tenantId: string) {
  const { data, error } = await sb.from("tenant_memberships").select("role").eq("tenant_id", tenantId).eq("user_id", userId).eq("active", true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.role as string);
}
async function requireFinanceAdmin(sb: any, userId: string, tenantId: string) {
  if (!(await financeRoles(sb,userId,tenantId)).some((role) => ["owner","admin","manager"].includes(role))) throw new Error("Usuário sem permissão financeira");
}
async function requirePaymentApprover(sb: any, userId: string, tenantId: string) {
  if (!(await financeRoles(sb,userId,tenantId)).some((role) => ["owner","admin"].includes(role))) throw new Error("Somente administrador pode aprovar pagamentos");
}
export const getFinancialSetup = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const sb = tdb(context.supabase); await requireFinanceAdmin(sb, context.userId, context.tenantId);
  const [centers, categories] = await Promise.all([
    sb.from("cost_centers").select("id,name,active,created_at").eq("tenant_id", context.tenantId).order("name"),
    sb.from("expense_categories").select("id,name,default_kind,active,created_at").eq("tenant_id", context.tenantId).order("name"),
  ]);
  if (centers.error) throw new Error(centers.error.message); if (categories.error) throw new Error(categories.error.message);
  return { centers: centers.data ?? [], categories: categories.data ?? [] };
});
export const saveCostCenter = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((v) => z.object({ id:z.string().uuid().optional(), name:z.string().trim().min(2).max(100), active:z.boolean().default(true) }).parse(v)).handler(async ({data,context}) => {
  const sb=tdb(context.supabase); await requireFinanceAdmin(sb,context.userId,context.tenantId);
  const payload={tenant_id:context.tenantId,name:data.name,active:data.active,created_by:context.userId};
  const q=data.id ? (sb.from("cost_centers") as any).update(payload).eq("id",data.id).eq("tenant_id",context.tenantId) : (sb.from("cost_centers") as any).insert(payload);
  const {error}=await q; if(error) throw new Error(error.message); return {ok:true};
});
export const saveExpenseCategory = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((v) => z.object({ id:z.string().uuid().optional(), name:z.string().trim().min(2).max(100), default_kind:z.enum(["fixed","variable"]), active:z.boolean().default(true) }).parse(v)).handler(async ({data,context}) => {
  const sb=tdb(context.supabase); await requireFinanceAdmin(sb,context.userId,context.tenantId);
  const payload={tenant_id:context.tenantId,name:data.name,default_kind:data.default_kind,active:data.active,created_by:context.userId};
  const q=data.id ? (sb.from("expense_categories") as any).update(payload).eq("id",data.id).eq("tenant_id",context.tenantId) : (sb.from("expense_categories") as any).insert(payload);
  const {error}=await q; if(error) throw new Error(error.message); return {ok:true};
});
export const getPayables = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
 const sb=tdb(context.supabase); const roles=await financeRoles(sb,context.userId,context.tenantId); await requireFinanceAdmin(sb,context.userId,context.tenantId);
 const [expenses,categories,centers,attachments]=await Promise.all([
  sb.from("expenses").select("id,description,kind,status,amount,competence_date,due_date,paid_at,supplier_name,document_number,notes,recurring,recurrence,source_type,source_id,installment_group_id,installment_number,installment_total,approval_status,approved_at,approval_note,category:expense_categories(name),cost_center:cost_centers(name)").eq("tenant_id",context.tenantId).order("due_date",{ascending:true}).limit(500),
  sb.from("expense_categories").select("id,name,default_kind").eq("tenant_id",context.tenantId).eq("active",true).order("name"),
  sb.from("cost_centers").select("id,name").eq("tenant_id",context.tenantId).eq("active",true).order("name"),
  (sb as any).from("financial_attachments").select("id,expense_id,kind,file_name,content_type,byte_size,storage_path,created_at").eq("tenant_id",context.tenantId).order("created_at",{ascending:false}),
 ]);
 for(const result of [expenses,categories,centers,attachments]) if(result.error) throw new Error(result.error.message);
 return { expenses:expenses.data??[], categories:categories.data??[], centers:centers.data??[], attachments:attachments.data??[], canApprove:roles.some((role)=>["owner","admin"].includes(role)) };
});
const payableSchema=z.object({id:z.string().uuid().optional(),category_id:z.string().uuid(),cost_center_id:z.string().uuid(),description:z.string().trim().min(2).max(300),amount:z.number().positive().max(999999999),competence_date:z.string().date(),due_date:z.string().date(),supplier_name:z.string().trim().max(180).optional(),document_number:z.string().trim().max(100).optional(),notes:z.string().trim().max(2000).optional(),recurring:z.boolean().default(false),recurrence:z.enum(["monthly","weekly","yearly"]).optional(),installments:z.number().int().min(1).max(120).default(1)});
const addMonths=(date:string,n:number)=>{const d=new Date(date+"T12:00:00");const day=d.getDate();d.setMonth(d.getMonth()+n);if(d.getDate()<day)d.setDate(0);return d.toISOString().slice(0,10);};
export const savePayable=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(v=>payableSchema.parse(v)).handler(async({data,context})=>{
 const sb=tdb(context.supabase);await requireFinanceAdmin(sb,context.userId,context.tenantId);const now=new Date().toISOString();
 if(data.id&&data.installments!==1) throw new Error("O parcelamento só pode ser definido ao criar o título");
 const base={tenant_id:context.tenantId,category_id:data.category_id,cost_center_id:data.cost_center_id,description:data.description,kind:"payable",status:"open",competence_date:data.competence_date,supplier_name:data.supplier_name||null,document_number:data.document_number||null,notes:data.notes||null,recurring:data.recurring,recurrence:data.recurring?(data.recurrence??"monthly"):null,updated_by:context.userId,updated_at:now};
 if(data.id){const {error}=await (sb.from("expenses") as any).update({...base,amount:data.amount,due_date:data.due_date}).eq("id",data.id).eq("tenant_id",context.tenantId).eq("status","open");if(error)throw new Error(error.message);return{ok:true,created:1};}
 const totalCents=Math.round(data.amount*100), count=data.installments, group=count>1?crypto.randomUUID():null, floor=Math.floor(totalCents/count);
 const rows=Array.from({length:count},(_,i)=>({...base,amount:(floor+(i===count-1?totalCents-floor*count:0))/100,due_date:addMonths(data.due_date,i),competence_date:addMonths(data.competence_date,i),approval_status:"pending",installment_group_id:group,installment_number:group?i+1:null,installment_total:group?count:null,created_by:context.userId}));
 const {error}=await (sb.from("expenses") as any).insert(rows);if(error)throw new Error(error.message);return{ok:true,created:rows.length};
});
export const approvePayable=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(v=>z.object({id:z.string().uuid(),decision:z.enum(["approved","rejected"]),note:z.string().trim().max(1000).optional()}).parse(v)).handler(async({data,context})=>{
 const sb=tdb(context.supabase);await requirePaymentApprover(sb,context.userId,context.tenantId);const {data:row,error}=await (sb.from("expenses") as any).update({approval_status:data.decision,approved_by:context.userId,approved_at:new Date().toISOString(),approval_note:data.note||null,updated_by:context.userId,updated_at:new Date().toISOString()}).eq("id",data.id).eq("tenant_id",context.tenantId).eq("status","open").eq("approval_status","pending").select("id").maybeSingle();if(error)throw new Error(error.message);if(!row)throw new Error("Título não está aguardando aprovação");return{ok:true};
});
export const settlePayable=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(v=>z.object({id:z.string().uuid(),paidAt:z.string().datetime().optional()}).parse(v)).handler(async({data,context})=>{
 const sb=tdb(context.supabase);await requireFinanceAdmin(sb,context.userId,context.tenantId);const {data:row,error}=await (sb.from("expenses") as any).update({status:"paid",paid_at:data.paidAt??new Date().toISOString(),updated_by:context.userId,updated_at:new Date().toISOString()}).eq("id",data.id).eq("tenant_id",context.tenantId).eq("status","open").eq("approval_status","approved").select("id").maybeSingle();if(error)throw new Error(error.message);if(!row)throw new Error("Título precisa estar aprovado antes da baixa");return{ok:true};
});

const receivableSchema=z.object({id:z.string().uuid().optional(),customer_id:z.string().uuid().optional(),customer_name:z.string().trim().min(2).max(180),description:z.string().trim().min(2).max(300),amount:z.number().positive().max(999999999),due_date:z.string().date(),payment_method:z.string().trim().max(60).optional(),payment_reference:z.string().trim().max(120).optional(),notes:z.string().trim().max(2000).optional()});
export const getReceivables=createServerFn({method:"GET"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const sb=tdb(context.supabase);await requireFinanceAdmin(sb,context.userId,context.tenantId);
 const [receivables,expenses]=await Promise.all([
  (sb as any).from("financial_receivables").select("id,source_type,source_id,customer_name,description,amount,due_date,payment_method,payment_reference,payment_url,status,received_at,notes,created_at").eq("tenant_id",context.tenantId).order("due_date",{ascending:true}).limit(1000),
  sb.from("expenses").select("id,description,amount,due_date,status,paid_at").eq("tenant_id",context.tenantId).order("due_date",{ascending:true}).limit(1000),
 ]);
 if(receivables.error)throw new Error(receivables.error.message);if(expenses.error)throw new Error(expenses.error.message);
 return {receivables:receivables.data??[],expenses:expenses.data??[]};
});
export const saveReceivable=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(v=>receivableSchema.parse(v)).handler(async({data,context})=>{
 const sb=tdb(context.supabase);await requireFinanceAdmin(sb,context.userId,context.tenantId);
 const payload={tenant_id:context.tenantId,source_type:"manual",source_id:null,customer_id:data.customer_id??null,customer_name:data.customer_name,description:data.description,amount:data.amount,due_date:data.due_date,payment_method:data.payment_method||null,payment_reference:data.payment_reference||null,notes:data.notes||null,updated_by:context.userId,updated_at:new Date().toISOString(),...(data.id?{}:{created_by:context.userId})};
 const q=data.id?(sb as any).from("financial_receivables").update(payload).eq("id",data.id).eq("tenant_id",context.tenantId):(sb as any).from("financial_receivables").insert(payload);
 const {error}=await q;if(error)throw new Error(error.message);return{ok:true};
});
export const settleReceivable=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(v=>z.object({id:z.string().uuid(),receivedAt:z.string().datetime().optional()}).parse(v)).handler(async({data,context})=>{
 const sb=tdb(context.supabase);await requireFinanceAdmin(sb,context.userId,context.tenantId);
 const {error}=await (sb as any).from("financial_receivables").update({status:"received",received_at:data.receivedAt??new Date().toISOString(),updated_by:context.userId,updated_at:new Date().toISOString()}).eq("id",data.id).eq("tenant_id",context.tenantId).eq("status","open");
 if(error)throw new Error(error.message);return{ok:true};
});
const sourceStatus=(value:string|undefined)=>["paid","approved","confirmed","completed","received"].includes((value??"").toLowerCase())?"received":"open";
export const syncReceivables=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const sb=tdb(context.supabase);await requireFinanceAdmin(sb,context.userId,context.tenantId);const now=new Date().toISOString();
 const [intents,payments,allSiteOrders,b2bOrders]=await Promise.all([
  sb.from("payment_intents").select("id,order_id,method,amount,status,paid_at,external_id,boleto_url,created_at,order:orders(customer_id,customer_name,created_at)").eq("tenant_id",context.tenantId).not("status","in",'("cancelled","failed","refunded")'),
  sb.from("pos_payments").select("id,sale_id,method,amount,status,provider_reference,created_at,sale:pos_sales(customer_id,status,created_at)").eq("tenant_id",context.tenantId).not("status","in",'("cancelled","void","refunded")'),
  sb.from("orders").select("id,customer_id,customer_name,total,payment_method,created_at").eq("tenant_id",context.tenantId),
  sb.from("sales_orders").select("id,customer_id,lead_name,total,status,created_at,customer:customers(name)").eq("tenant_id",context.tenantId).is("order_id",null).not("status","in",'("cancelled","canceled","rejected")'),
 ]);
 for(const result of [intents,payments,allSiteOrders,b2bOrders])if(result.error)throw new Error(result.error.message);
 const intentOrderIds=new Set((intents.data??[]).map((x:any)=>x.order_id));const rows:any[]=[];
 for(const x of intents.data??[]){const o:any=x.order;rows.push({tenant_id:context.tenantId,source_type:"payment_intent",source_id:x.id,customer_id:o?.customer_id??null,customer_name:o?.customer_name??"Cliente do site",description:"Pedido do site",amount:x.amount,due_date:(x.created_at??now).slice(0,10),payment_method:x.method,payment_reference:x.external_id??null,payment_url:x.boleto_url??null,status:sourceStatus(x.status),received_at:sourceStatus(x.status)==="received"?(x.paid_at??now):null,updated_by:context.userId,updated_at:now,created_by:context.userId});}
 for(const x of payments.data??[]){const sale:any=x.sale;if((sale?.status??"").toLowerCase().includes("cancel"))continue;rows.push({tenant_id:context.tenantId,source_type:"pos_payment",source_id:x.id,customer_id:sale?.customer_id??null,customer_name:"Cliente PDV",description:"Venda no PDV",amount:x.amount,due_date:(x.created_at??now).slice(0,10),payment_method:x.method,payment_reference:x.provider_reference??null,status:sourceStatus(x.status),received_at:sourceStatus(x.status)==="received"?(x.created_at??now):null,updated_by:context.userId,updated_at:now,created_by:context.userId});}
 for(const x of allSiteOrders.data??[]){if(intentOrderIds.has(x.id))continue;rows.push({tenant_id:context.tenantId,source_type:"site_order",source_id:x.id,customer_id:x.customer_id??null,customer_name:x.customer_name,description:"Pedido do site sem cobrança vinculada",amount:x.total,due_date:(x.created_at??now).slice(0,10),payment_method:x.payment_method??null,status:"open",received_at:null,updated_by:context.userId,updated_at:now,created_by:context.userId});}
 for(const x of b2bOrders.data??[]){const c:any=x.customer;rows.push({tenant_id:context.tenantId,source_type:"b2b_order",source_id:x.id,customer_id:x.customer_id??null,customer_name:c?.name??x.lead_name??"Cliente B2B",description:"Pedido B2B",amount:x.total,due_date:(x.created_at??now).slice(0,10),payment_method:"a combinar",status:"open",received_at:null,updated_by:context.userId,updated_at:now,created_by:context.userId});}
 if(rows.length){const {error}=await (sb as any).from("financial_receivables").upsert(rows,{onConflict:"tenant_id,source_type,source_id"});if(error)throw new Error(error.message);}
 return {ok:true,synced:rows.length};
});