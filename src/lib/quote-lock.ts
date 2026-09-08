/**
 * Regra única de imutabilidade comercial (frontend + backend).
 *
 * Só é possível editar conteúdo comercial quando o documento é exatamente
 * um orçamento em rascunho que nunca foi enviado. Qualquer outro estado
 * (proposta, enviado, em_negociacao, aprovado, recusado, convertido,
 * expirado, ou qualquer documento com sent_at preenchido) é bloqueado.
 */
export type QuoteLockShape = {
  document_type?: string | null;
  status?: string | null;
  sent_at?: string | null;
};

export const QUOTE_LOCKED_MESSAGE =
  "Este documento comercial já foi enviado ou encerrado e está bloqueado para edição. Crie uma revisão para alterar condições, itens ou preços.";

export function isQuoteCommerciallyLocked(quote: QuoteLockShape | null | undefined): boolean {
  if (!quote) return false;
  if (quote.document_type !== "orcamento") return true;
  if (quote.status !== "rascunho") return true;
  if (quote.sent_at) return true;
  return false;
}
