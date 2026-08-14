/**
 * Helpers server-only do módulo Suprimentos (Fornecedores, Compras, Recebimento).
 * Mantém `supplies.functions.ts` como wrapper fino (exigência do code-splitting).
 */

/**
 * Suprimentos é restrito a perfis administrativos e de gerência:
 * `owner`/`admin` (ADMIN) e `manager` (GERENTE). Nenhum outro perfil lê,
 * cria, confirma ou estorna documentos do módulo.
 */
export const SUPPLY_READ_ROLES = ["owner", "admin", "manager"];
export const SUPPLY_WRITE_ROLES = ["owner", "admin", "manager"];
export const SUPPLY_APPROVE_ROLES = ["owner", "admin", "manager"];

export type SupplyMembership = { tenant_id: string; role: string };

export async function requireSupplyRole(
  sb: any,
  userId: string,
  tenantId: string,
  roles: string[] = SUPPLY_WRITE_ROLES,
): Promise<SupplyMembership> {
  const { data, error } = await sb
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("active", true);

  if (error) throw new Error(error.message);
  const membership = (data ?? []).find((item: { role: string }) => roles.includes(item.role));
  if (!membership) throw new Error("Usuário sem permissão para esta operação de suprimentos");
  return membership as SupplyMembership;
}

export type SupplyOrderItemInput = {
  product_id: string;
  ordered_qty: number;
  unit_cost: number;
  discount_amount?: number;
  tax_amount?: number;
  notes?: string | null;
};

export function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function lineTotal(item: SupplyOrderItemInput): number {
  const gross = Number(item.ordered_qty) * Number(item.unit_cost);
  return round2(gross - Number(item.discount_amount ?? 0) + Number(item.tax_amount ?? 0));
}

export function normalizeItems(items: SupplyOrderItemInput[]): SupplyOrderItemInput[] {
  const merged = new Map<string, SupplyOrderItemInput>();
  for (const raw of items) {
    const qty = Number(raw.ordered_qty);
    const cost = Number(raw.unit_cost);
    if (!raw.product_id) throw new Error("Item sem produto selecionado");
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantidade do item deve ser maior que zero");
    if (!Number.isFinite(cost) || cost < 0) throw new Error("Custo unitário inválido");

    const current = merged.get(raw.product_id);
    if (current) {
      current.ordered_qty += qty;
      current.discount_amount = Number(current.discount_amount ?? 0) + Number(raw.discount_amount ?? 0);
      current.tax_amount = Number(current.tax_amount ?? 0) + Number(raw.tax_amount ?? 0);
      current.unit_cost = cost;
    } else {
      merged.set(raw.product_id, {
        product_id: raw.product_id,
        ordered_qty: qty,
        unit_cost: cost,
        discount_amount: Number(raw.discount_amount ?? 0),
        tax_amount: Number(raw.tax_amount ?? 0),
        notes: raw.notes ?? null,
      });
    }
  }
  const list = [...merged.values()];
  if (list.length === 0) throw new Error("Inclua ao menos um item no pedido de compra");
  return list;
}

export function orderTotals(
  items: SupplyOrderItemInput[],
  extras: { freight_amount?: number; discount_amount?: number; other_amount?: number },
) {
  const itemsTotal = round2(items.reduce((sum, item) => sum + lineTotal(item), 0));
  const total = round2(
    itemsTotal +
      Number(extras.freight_amount ?? 0) +
      Number(extras.other_amount ?? 0) -
      Number(extras.discount_amount ?? 0),
  );
  return { itemsTotal, total: Math.max(0, total) };
}

export const SUPPLY_PRODUCT_SELECT =
  "id, sku, internal_code, manufacturer_code, name, price_b2c, last_purchase_cost, average_cost, brand:brands(name)";

export function mapSupplyProduct(row: any) {
  return {
    id: row.id as string,
    sku: row.sku as string,
    internal_code: (row.internal_code ?? null) as string | null,
    manufacturer_code: (row.manufacturer_code ?? null) as string | null,
    name: row.name as string,
    brand: (row.brand?.name ?? null) as string | null,
    price_b2c: Number(row.price_b2c ?? 0),
    last_purchase_cost: row.last_purchase_cost == null ? null : Number(row.last_purchase_cost),
    average_cost: row.average_cost == null ? null : Number(row.average_cost),
  };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_,()]/g, " ").trim();
}
