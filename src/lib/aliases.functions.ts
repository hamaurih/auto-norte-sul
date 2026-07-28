import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeTerm } from "./normalize";

async function assertRoles(sb: any, userId: string, roles: string[]) {
  const { data } = await sb.from("user_roles").select("role").eq("user_id", userId);
  if (!(data ?? []).some((r: { role: string }) => roles.includes(r.role))) throw new Error("Forbidden");
}

export const listAliases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { search?: string; targetType?: string; onlyActive?: boolean; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("search_aliases").select("*").order("normalized_term").limit(Math.min(data.limit ?? 500, 2000));
    if (data.search) {
      const n = normalizeTerm(data.search);
      q = q.or(`term.ilike.%${data.search}%,normalized_term.ilike.%${n}%,target_label.ilike.%${data.search}%`);
    }
    if (data.targetType) q = q.eq("target_type", data.targetType);
    if (data.onlyActive) q = q.eq("is_active", true);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string;
    term: string;
    target_type: "product" | "category" | "brand" | "tag" | "generic";
    target_slug?: string | null;
    target_id?: string | null;
    target_label?: string | null;
    weight?: number;
    is_active?: boolean;
  }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const row = {
      term: data.term.trim(),
      normalized_term: normalizeTerm(data.term),
      target_type: data.target_type,
      target_slug: data.target_slug ?? null,
      target_id: data.target_id ?? null,
      target_label: data.target_label ?? null,
      weight: data.weight ?? 10,
      is_active: data.is_active ?? true,
    };
    if (data.id) {
      const { error } = await context.supabase.from("search_aliases").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await context.supabase.from("search_aliases").upsert(row, { onConflict: "normalized_term,target_type,target_slug" }).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins.id };
  });

export const deleteAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const { error } = await context.supabase.from("search_aliases").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; is_active: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertRoles(context.supabase, context.userId, ["admin", "gerente"]);
    const { error } = await context.supabase.from("search_aliases").update({ is_active: data.is_active }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ NO-RESULT LOGS ============
export const listNoResultLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number }) => input)
  .handler(async ({ data, context }) => {
    // Agrupar por termo normalizado
    const { data: rows, error } = await context.supabase
      .from("search_no_result_logs")
      .select("term, normalized_term, origin, created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(data.limit ?? 500, 2000));
    if (error) throw new Error(error.message);
    const grouped = new Map<string, { term: string; normalized_term: string; count: number; last_seen: string; origins: Set<string> }>();
    for (const r of rows ?? []) {
      const cur = grouped.get(r.normalized_term) ?? { term: r.term, normalized_term: r.normalized_term, count: 0, last_seen: r.created_at, origins: new Set<string>() };
      cur.count++;
      cur.origins.add(r.origin);
      if (r.created_at > cur.last_seen) cur.last_seen = r.created_at;
      grouped.set(r.normalized_term, cur);
    }
    return Array.from(grouped.values())
      .map((g) => ({ ...g, origins: Array.from(g.origins) }))
      .sort((a, b) => b.count - a.count);
  });
