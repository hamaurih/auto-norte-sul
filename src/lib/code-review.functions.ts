import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { normalizeCode, normalizeName } from "@/lib/product-codes";
import { mapAuditRow, requireCodeReviewRole, type CodeReviewRow } from "@/lib/code-review.server";

export const listCodeReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number; offset?: number; status?: string }) => input)
  .handler(async ({ data, context }): Promise<{ rows: CodeReviewRow[]; total: number }> => {
    const sb = tdb(context.supabase) as any;
    const membership = await requireCodeReviewRole(sb, context.userId, context.tenantId);
    const limit = Math.min(data.limit ?? 50, 200);
    const offset = data.offset ?? 0;
    const status = data.status ?? "review_required";

    const { data: audits, error, count } = await sb
      .from("product_code_normalization_audit")
      .select("*", { count: "exact" })
      .eq("status", status)
      .order("created_at", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((audits ?? []).map((a: any) => a.product_id).filter(Boolean)));
    let products: any[] = [];
    if (ids.length > 0) {
      const { data: prods } = await sb
        .from("products")
        .select("id, sku, name, internal_code, manufacturer_code")
        .eq("tenant_id", membership.tenant_id)
        .in("id", ids);
      products = prods ?? [];
    }
    const byId = new Map(products.map((p) => [String(p.id), p]));
    return {
      rows: (audits ?? []).map((a: any) => mapAuditRow(a, a.product_id ? byId.get(String(a.product_id)) ?? null : null)),
      total: count ?? 0,
    };
  });

export const applyCodeReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      auditId: string;
      productId: string;
      name: string;
      internal_code?: string | null;
      manufacturer_code?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase) as any;
    const membership = await requireCodeReviewRole(sb, context.userId, context.tenantId);

    const name = normalizeName(data.name);
    if (!name) throw new Error("Nome do produto é obrigatório");
    const internal = normalizeCode(data.internal_code);
    const manufacturer = normalizeCode(data.manufacturer_code);

    const { error: upErr } = await sb
      .from("products")
      .update({
        name,
        internal_code: internal,
        manufacturer_code: manufacturer,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.productId)
      .eq("tenant_id", membership.tenant_id);
    if (upErr) throw new Error(upErr.message);

    const { error: auditErr } = await sb
      .from("product_code_normalization_audit")
      .update({
        status: "applied",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.auditId);
    if (auditErr) throw new Error(auditErr.message);

    // Aviso de duplicidade do código interno no mesmo tenant (não bloqueia).
    let duplicateOf: string[] = [];
    if (internal) {
      const { data: dups } = await sb
        .from("products")
        .select("id, name")
        .eq("tenant_id", membership.tenant_id)
        .eq("internal_code", internal)
        .neq("id", data.productId)
        .limit(5);
      duplicateOf = (dups ?? []).map((d: any) => d.name as string);
    }
    return { ok: true, duplicateOf };
  });
