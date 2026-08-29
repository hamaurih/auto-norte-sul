/**
 * Helpers server-only do módulo PDV (histórico, detalhe, cancelamento, caixa).
 *
 * Ficam fora de `pos-history.functions.ts` porque o splitter de server
 * functions remove tudo o que não é declaração de `createServerFn`: helpers
 * irmãos usados dentro dos handlers viram `ReferenceError` em runtime.
 */
import type { TenantDb } from "@/integrations/supabase/tenant-db";

export const SALE_CODE_LENGTH = 8;
export const CANCEL_ROLES = ["owner", "admin", "manager"];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HEX_PREFIX_RE = /^[0-9a-f]{4,8}$/i;

export const saleCode = (id: string) => id.slice(0, SALE_CODE_LENGTH).toUpperCase();

export function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function nameMaps(
  sb: TenantDb,
  tenantId: string,
  operatorIds: string[],
  customerIds: string[],
) {
  const operators = new Map<string, string>();
  const customers = new Map<string, { name: string; document: string | null }>();

  if (operatorIds.length) {
    const { data } = await sb.from("profiles").select("id, full_name").in("id", operatorIds);
    for (const row of data ?? []) operators.set(row.id as string, (row.full_name as string) ?? "");
  }
  if (customerIds.length) {
    const { data } = await sb
      .from("customers")
      .select("id, name, document")
      .eq("tenant_id", tenantId)
      .in("id", customerIds);
    for (const row of data ?? []) {
      customers.set(row.id as string, {
        name: (row.name as string) ?? "",
        document: (row.document as string) ?? null,
      });
    }
  }
  return { operators, customers };
}

/** Papel efetivo do usuário no tenant ativo, resolvido no servidor. */
export async function tenantRole(sb: TenantDb, tenantId: string, userId: string) {
  const { data } = await sb
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (data?.role) return String(data.role);
  return null;
}
