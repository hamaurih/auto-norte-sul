/**
 * Helpers server-only da "Revisão de códigos" (product_code_normalization_audit).
 * Mantém `code-review.functions.ts` como wrapper fino (code-splitting).
 */

export const CODE_REVIEW_ROLES = ["owner", "admin", "manager", "stock"];

export type CodeReviewMembership = { tenant_id: string; role: string };

export async function requireCodeReviewRole(
  sb: any,
  userId: string,
  tenantId: string,
): Promise<CodeReviewMembership> {
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((m: { role: string }) => CODE_REVIEW_ROLES.includes(m.role));
  if (!membership) throw new Error("Usuário sem permissão para revisar códigos de produto");
  return membership as CodeReviewMembership;
}

export type CodeReviewRow = {
  id: string;
  product_id: string | null;
  reason: string | null;
  status: string | null;
  original: { sku: string | null; name: string | null; internal_code: string | null; manufacturer_code: string | null };
  proposed: { name: string | null; internal_code: string | null; manufacturer_code: string | null };
  current: { sku: string | null; name: string | null; internal_code: string | null; manufacturer_code: string | null } | null;
};

/** Lê a linha de auditoria de forma tolerante a variações de nome de coluna. */
export function mapAuditRow(row: any, product: any | null): CodeReviewRow {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (row?.[k] != null) return String(row[k]);
    return null;
  };
  return {
    id: String(row.id),
    product_id: row.product_id ? String(row.product_id) : null,
    reason: pick("reason", "motivo", "note", "details"),
    status: pick("status"),
    original: {
      sku: pick("original_sku", "old_sku", "sku_original", "sku"),
      name: pick("original_name", "old_name", "name_original"),
      internal_code: pick("original_internal_code", "old_internal_code"),
      manufacturer_code: pick("original_manufacturer_code", "old_manufacturer_code"),
    },
    proposed: {
      name: pick("proposed_name", "new_name", "name_proposed"),
      internal_code: pick("proposed_internal_code", "new_internal_code"),
      manufacturer_code: pick("proposed_manufacturer_code", "new_manufacturer_code"),
    },
    current: product
      ? {
          sku: product.sku ?? null,
          name: product.name ?? null,
          internal_code: product.internal_code ?? null,
          manufacturer_code: product.manufacturer_code ?? null,
        }
      : null,
  };
}
