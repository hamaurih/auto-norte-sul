/**
 * Helpers server-only da importação de XML de NF-e de compra.
 * Mantém `nfe.functions.ts` como wrapper fino (exigência do code-splitting).
 */

import { isValidGtin, type NfeItem } from "./nfe-xml";
import { normalizeCode } from "./product-codes";

export const NFE_STATUSES = [
  "importado",
  "em_conferencia",
  "divergente",
  "pronto",
  "confirmado",
  "cancelado",
] as const;

export type NfeStatus = (typeof NFE_STATUSES)[number];

export type MatchSource =
  | "none"
  | "gtin"
  | "manufacturer_code"
  | "sku"
  | "internal_code"
  | "supplier_code"
  | "manual";

export type MatchConfidence = "alta" | "media" | "baixa" | "pendente";

export type ProductCandidate = {
  id: string;
  sku: string | null;
  internal_code: string | null;
  manufacturer_code: string | null;
  gtin: string | null;
  name: string;
  last_purchase_cost: number | null;
  average_cost: number | null;
};

export const NFE_PRODUCT_SELECT =
  "id, sku, internal_code, manufacturer_code, gtin, name, last_purchase_cost, average_cost";

/** SHA-256 do arquivo (Web Crypto: disponível no runtime do servidor). */
export async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function confidenceFor(source: MatchSource): MatchConfidence {
  if (source === "gtin" || source === "manual" || source === "supplier_code") return "alta";
  if (source === "manufacturer_code" || source === "internal_code" || source === "sku") return "media";
  return "pendente";
}

/**
 * Vínculo automático do item da NF-e, na ordem obrigatória:
 * GTIN válido → código do fabricante → SKU/código interno → (manual).
 * Nunca cria produto: itens sem correspondência ficam pendentes.
 */
export function matchNfeItem(
  item: NfeItem,
  products: ProductCandidate[],
  supplierCodeMap: Map<string, string>,
): { product_id: string | null; match_source: MatchSource } {
  const supplierCode = normalizeCode(item.supplier_code);
  if (supplierCode) {
    const learned = supplierCodeMap.get(supplierCode);
    if (learned) return { product_id: learned, match_source: "supplier_code" };
  }

  if (item.gtin && isValidGtin(item.gtin)) {
    const byGtin = products.find((p) => (p.gtin ?? "").replace(/\D/g, "") === item.gtin);
    if (byGtin) return { product_id: byGtin.id, match_source: "gtin" };
  }

  if (supplierCode) {
    const byManufacturer = products.find((p) => normalizeCode(p.manufacturer_code) === supplierCode);
    if (byManufacturer) return { product_id: byManufacturer.id, match_source: "manufacturer_code" };

    const byInternal = products.find((p) => normalizeCode(p.internal_code) === supplierCode);
    if (byInternal) return { product_id: byInternal.id, match_source: "internal_code" };

    const bySku = products.find((p) => normalizeCode(p.sku) === supplierCode);
    if (bySku) return { product_id: bySku.id, match_source: "sku" };
  }

  return { product_id: null, match_source: "none" };
}

export type ItemDivergence = { kind: string; message: string };

/** Divergências de conferência do item (produto, custo e quantidade x pedido). */
export function itemDivergences(input: {
  matched: boolean;
  xmlQty: number;
  xmlUnitCost: number;
  orderQty?: number | null;
  orderReceivedQty?: number | null;
  orderUnitCost?: number | null;
  lastCost?: number | null;
}): ItemDivergence[] {
  const list: ItemDivergence[] = [];
  if (!input.matched) {
    list.push({ kind: "produto", message: "Item sem produto vinculado." });
    return list;
  }

  if (input.orderQty != null) {
    const pending = Number(input.orderQty) - Number(input.orderReceivedQty ?? 0);
    if (input.xmlQty > pending + 1e-6) {
      list.push({
        kind: "quantidade",
        message: `Quantidade do XML (${input.xmlQty}) acima do saldo do pedido (${pending}).`,
      });
    } else if (input.xmlQty < pending - 1e-6) {
      list.push({
        kind: "quantidade",
        message: `Quantidade do XML (${input.xmlQty}) menor que o saldo do pedido (${pending}).`,
      });
    }
  }

  if (input.orderUnitCost != null && Number(input.orderUnitCost) > 0) {
    const diff = Math.abs(input.xmlUnitCost - Number(input.orderUnitCost));
    if (diff / Number(input.orderUnitCost) > 0.01) {
      list.push({
        kind: "custo",
        message: `Custo do XML difere do pedido (pedido ${input.orderUnitCost} · XML ${input.xmlUnitCost}).`,
      });
    }
  } else if (input.lastCost != null && Number(input.lastCost) > 0) {
    const variation = (input.xmlUnitCost - Number(input.lastCost)) / Number(input.lastCost);
    if (Math.abs(variation) > 0.2) {
      list.push({
        kind: "custo",
        message: `Custo ${variation > 0 ? "acima" : "abaixo"} do último custo em ${(variation * 100).toFixed(1)}%.`,
      });
    }
  }

  return list;
}

/** Custo efetivo do item: (total - desconto + frete + outros) / quantidade. */
export function effectiveUnitCost(item: {
  qty: number;
  unit_value: number;
  total_amount: number;
  discount_amount: number;
  freight_amount: number;
  other_amount: number;
}): number {
  const qty = Number(item.qty);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const base = Number(item.total_amount) > 0 ? Number(item.total_amount) : qty * Number(item.unit_value);
  const net = base - Number(item.discount_amount ?? 0) + Number(item.freight_amount ?? 0) + Number(item.other_amount ?? 0);
  return Math.round((Math.max(net, 0) / qty) * 10000) / 10000;
}

/** Status derivado da conferência (nunca sai de confirmado/cancelado). */
export function deriveNfeStatus(
  current: NfeStatus,
  items: { product_id: string | null; divergences: ItemDivergence[] }[],
): NfeStatus {
  if (current === "confirmado" || current === "cancelado") return current;
  if (items.some((item) => !item.product_id)) return "em_conferencia";
  if (items.some((item) => (item.divergences ?? []).length > 0)) return "divergente";
  return "pronto";
}

export function formatTaxId(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return digits || "—";
}
