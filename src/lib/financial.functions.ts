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