import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

async function requireFinanceAdmin(sb: any, userId: string, tenantId: string) {
  const { data, error } = await sb.from("tenant_memberships").select("role").eq("tenant_id", tenantId).eq("user_id", userId).eq("active", true);
  if (error) throw new Error(error.message);
  if (!(data ?? []).some((r: any) => ["owner", "admin", "manager"].includes(r.role))) throw new Error("Usuário sem permissão financeira");
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
 const sb=tdb(context.supabase); await requireFinanceAdmin(sb,context.userId,context.tenantId);
 const [expenses,categories,centers]=await Promise.all([
  sb.from("expenses").select("id,description,kind,status,amount,competence_date,due_date,paid_at,supplier_name,document_number,notes,recurring,recurrence,category:expense_categories(name),cost_center:cost_centers(name)").eq("tenant_id",context.tenantId).order("due_date",{ascending:true}).limit(500),
  sb.from("expense_categories").select("id,name,default_kind").eq("tenant_id",context.tenantId).eq("active",true).order("name"),
  sb.from("cost_centers").select("id,name").eq("tenant_id",context.tenantId).eq("active",true).order("name"),
 ]);
 if(expenses.error)throw new Error(expenses.error.message);if(categories.error)throw new Error(categories.error.message);if(centers.error)throw new Error(centers.error.message);
 return { expenses:expenses.data??[], categories:categories.data??[], centers:centers.data??[] };
});
const payableSchema=z.object({id:z.string().uuid().optional(),category_id:z.string().uuid(),cost_center_id:z.string().uuid(),description:z.string().trim().min(2).max(300),amount:z.number().positive().max(999999999),competence_date:z.string().date(),due_date:z.string().date(),supplier_name:z.string().trim().max(180).optional(),document_number:z.string().trim().max(100).optional(),notes:z.string().trim().max(2000).optional(),recurring:z.boolean().default(false),recurrence:z.enum(["monthly","weekly","yearly"]).optional()});
export const savePayable=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(v=>payableSchema.parse(v)).handler(async({data,context})=>{
 const sb=tdb(context.supabase);await requireFinanceAdmin(sb,context.userId,context.tenantId);
 const payload={tenant_id:context.tenantId,category_id:data.category_id,cost_center_id:data.cost_center_id,description:data.description,kind:"payable",status:"open",amount:data.amount,competence_date:data.competence_date,due_date:data.due_date,supplier_name:data.supplier_name||null,document_number:data.document_number||null,notes:data.notes||null,recurring:data.recurring,recurrence:data.recurring?(data.recurrence??"monthly"):null,created_by:context.userId,updated_by:context.userId,updated_at:new Date().toISOString()};
 const q=data.id?(sb.from("expenses") as any).update(payload).eq("id",data.id).eq("tenant_id",context.tenantId):(sb.from("expenses") as any).insert(payload);
 const {error}=await q;if(error)throw new Error(error.message);return{ok:true};
});
export const settlePayable=createServerFn({method:"POST"}).middleware([requireSupabaseAuth]).inputValidator(v=>z.object({id:z.string().uuid(),paidAt:z.string().datetime().optional()}).parse(v)).handler(async({data,context})=>{
 const sb=tdb(context.supabase);await requireFinanceAdmin(sb,context.userId,context.tenantId);
 const {error}=await (sb.from("expenses") as any).update({status:"paid",paid_at:data.paidAt??new Date().toISOString(),updated_by:context.userId,updated_at:new Date().toISOString()}).eq("id",data.id).eq("tenant_id",context.tenantId).eq("status","open");
 if(error)throw new Error(error.message);return{ok:true};
});