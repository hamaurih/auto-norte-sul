/**
 * sanitize.ts — Utilitários de sanitização de input para queries.
 *
 * SEC-05: Escapa metacaracteres de LIKE/ILIKE do PostgreSQL para
 * prevenir Pattern Injection via input de usuário.
 *
 * PostgreSQL LIKE metacaracteres: % (qualquer sequência), _ (qualquer char), \ (escape)
 */

/**
 * Escapa metacaracteres de LIKE/ILIKE do PostgreSQL.
 * Use sempre que interpolar input de usuário em .ilike(), .like(), ou .or() com ilike.
 *
 * @example
 * // Antes (vulnerável):
 * .ilike('name', `%${userInput}%`)
 *
 * // Depois (seguro):
 * .ilike('name', `%${escapeLike(userInput)}%`)
 */
export function escapeLike(input: string): string {
  if (!input) return "";
  return input
    .replace(/\\/g, "\\\\") // \ → \\  (deve ser primeiro)
    .replace(/%/g, "\\%")   // % → \%
    .replace(/_/g, "\\_");  // _ → \_
}

/**
 * Normaliza e escapa um termo de busca para uso em queries ilike.
 * Remove caracteres especiais do PostgreSQL e limita o tamanho.
 */
export function sanitizeSearchTerm(input: string, maxLength = 200): string {
  if (!input) return "";
  const trimmed = input.trim().slice(0, maxLength);
  return escapeLike(trimmed);
}

/**
 * Remove caracteres que podem ser usados para injection em queries .or()
 * PostgREST-style (vírgula, parênteses, ponto).
 */
export function sanitizeOrQuery(input: string): string {
  if (!input) return "";
  return input.replace(/[,().]/g, " ").trim();
}
