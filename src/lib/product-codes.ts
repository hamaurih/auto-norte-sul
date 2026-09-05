/**
 * Regras definitivas dos códigos de produto.
 *
 * - `internal_code`  → código interno da Norte Sul (prefixos `AZ-` / `F-` herdados do SKU).
 * - `manufacturer_code` → código do fabricante; nunca deve ser confundido com o código interno.
 * - `sku` → campo técnico de compatibilidade com o Bling; nunca é apagado.
 */

/**
 * Normaliza um código sem destruir separadores legítimos do fabricante.
 * Remove sequências de tabulação/quebra de linha (inclusive o texto literal `\\t`),
 * aplica trim, colapsa espaços comuns duplicados e converte para maiúsculas.
 */
export function normalizeCode(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = String(value)
    .replace(/\\t/gi, "")
    .replace(/[\t\r\n]+/g, "")
    .trim()
    .replace(/ {2,}/g, " ")
    .toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/** Normaliza o nome exibido: trim + espaços duplicados colapsados. */
export function normalizeName(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Código interno Norte Sul exige prefixo explícito `AZ-` ou `F-`.
 * Não considerar qualquer palavra iniciada por F como código da loja.
 */
export function skuLooksLikeInternalCode(sku: string | null | undefined): boolean {
  const code = normalizeCode(sku)?.replace(/\s+/g, "");
  if (!code) return false;
  return /^(AZ|F)-/.test(code);
}

/**
 * Deriva o código interno a partir do SKU sem apagar o SKU.
 * Para códigos Norte Sul, espaços não fazem parte do identificador.
 */
export function deriveInternalCodeFromSku(sku: string | null | undefined): string | null {
  const code = normalizeCode(sku)?.replace(/\s+/g, "") ?? null;
  return code && /^(AZ|F)-/.test(code) ? code : null;
}

/**
 * Extração conservadora do código do fabricante no início do nome.
 *
 * Esta função apenas separa um candidato textual. A aplicação automática em
 * `manufacturer_code` exige evidência adicional (marca/fonte/padrão histórico)
 * no fluxo de saneamento; o token isolado nunca é evidência suficiente.
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
  if (/^(AZ|F)-/i.test(token)) return { name, manufacturerCode: null };
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
