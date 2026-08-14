/**
 * Regras definitivas dos códigos de produto.
 *
 * - `internal_code`  → código interno da Norte Sul (prefixos AZ / F herdados do SKU).
 * - `manufacturer_code` → código do fabricante, normalmente extraído do início do nome.
 * - `sku` → campo técnico de compatibilidade com o Bling; nunca é apagado.
 */

/** Normaliza um código: trim, espaços internos removidos e maiúsculas. */
export function normalizeCode(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = String(value).trim().replace(/\s+/g, " ").toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/** Normaliza o nome exibido: trim + espaços duplicados colapsados. */
export function normalizeName(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/** SKUs iniciados por AZ ou F são, na prática, códigos internos. */
export function skuLooksLikeInternalCode(sku: string | null | undefined): boolean {
  const code = normalizeCode(sku);
  if (!code) return false;
  return /^(AZ|F)/.test(code);
}

/**
 * Deriva o código interno a partir do SKU sem apagar o SKU.
 * Retorna `null` quando o SKU não segue o padrão interno.
 */
export function deriveInternalCodeFromSku(sku: string | null | undefined): string | null {
  return skuLooksLikeInternalCode(sku) ? normalizeCode(sku) : null;
}

/**
 * Extração conservadora do código do fabricante no início do nome.
 *
 * Aceita apenas quando:
 * - o primeiro token contém pelo menos um dígito;
 * - o token está delimitado por espaço, parênteses ou hífen;
 * - o token NÃO é do padrão "número seguido de 4+ letras" (ex.: `12VOLTS`,
 *   `4PORTAS`), que costuma ser parte real do nome e pode estar colado à
 *   primeira palavra.
 */
export function splitManufacturerCodeFromName(rawName: string | null | undefined): {
  name: string;
  manufacturerCode: string | null;
} {
  const name = normalizeName(rawName);
  if (!name) return { name, manufacturerCode: null };

  const match = name.match(/^([A-Za-z0-9][A-Za-z0-9._/-]{2,})(?:\s+|\s*[()\-]\s*)(.+)$/);
  if (!match) return { name, manufacturerCode: null };

  const token = match[1];
  const rest = normalizeName(match[2]);
  if (!rest) return { name, manufacturerCode: null };
  if (!/\d/.test(token)) return { name, manufacturerCode: null };
  // número seguido por 4+ letras → medida/descrição, não código
  if (/^\d+[A-Za-z]{4,}$/.test(token)) return { name, manufacturerCode: null };

  return { name: rest, manufacturerCode: normalizeCode(token) };
}

/** Colunas pesquisáveis de código/nome (busca administrativa, PDV, compras). */
export const PRODUCT_SEARCH_COLUMNS = ["name", "internal_code", "manufacturer_code", "sku"] as const;

/** Escapa o termo para uso seguro dentro de um filtro PostgREST `.or(...)`. */
export function sanitizeSearchTerm(term: string): string {
  return term.trim().replace(/[,()*%\\"']/g, " ").replace(/\s+/g, " ").trim();
}

/** Constrói o filtro `.or(...)` de busca por nome + três códigos. */
export function buildProductSearchFilter(term: string): string | null {
  const safe = sanitizeSearchTerm(term);
  if (!safe) return null;
  return PRODUCT_SEARCH_COLUMNS.map((c) => `${c}.ilike.%${safe}%`).join(",");
}
