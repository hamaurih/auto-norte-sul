/** Rótulos e cores do módulo comercial de orçamentos (uso apenas na interface). */

export const QUOTE_STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado ao cliente",
  em_negociacao: "Em negociação",
  aprovado: "Aprovado",
  recusado: "Perdido",
  convertido: "Fechado",
  expirado: "Expirado",
};

export const QUOTE_STATUS_TONE: Record<string, string> = {
  rascunho: "bg-slate-100 text-slate-700",
  enviado: "bg-blue-100 text-blue-700",
  em_negociacao: "bg-amber-100 text-amber-800",
  aprovado: "bg-emerald-100 text-emerald-700",
  recusado: "bg-rose-100 text-rose-700",
  convertido: "bg-indigo-100 text-indigo-700",
  expirado: "bg-zinc-200 text-zinc-700",
};

export const QUOTE_ORIGIN_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  ia: "Atendimento IA",
  site: "Site",
  vendedor: "Vendedor",
  balcao: "Balcão",
  b2b: "B2B",
};

export function statusLabel(status?: string | null) {
  return QUOTE_STATUS_LABEL[status ?? ""] ?? "Sem etapa";
}

export function statusTone(status?: string | null) {
  return QUOTE_STATUS_TONE[status ?? ""] ?? "bg-slate-100 text-slate-700";
}

export function originLabel(origin?: string | null) {
  return QUOTE_ORIGIN_LABEL[origin ?? ""] ?? "—";
}

export function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("pt-BR") : "—";
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "—";
}

export function isOverdue(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time < Date.now();
}

export const EVENT_LABEL: Record<string, string> = {
  criado: "Orçamento criado",
  editado: "Orçamento atualizado",
  status: "Mudança de etapa",
  proposta_gerada: "Proposta gerada e enviada",
  revisao_criada: "Revisão criada",
  convertido: "Venda fechada e pedido gerado",
};

export function eventLabel(type: string) {
  return EVENT_LABEL[type] ?? type.replaceAll("_", " ");
}

export function isoDateInDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Etapas em que o documento comercial já saiu do rascunho e não pode mais ser editado. */
export const LOCKED_QUOTE_STATUSES = [
  "enviado",
  "em_negociacao",
  "aprovado",
  "recusado",
  "convertido",
  "expirado",
] as const;

/**
 * Regra única (frontend + backend): proposta enviada é imutável.
 * Só um orçamento em rascunho, nunca enviado, pode ser editado.
 */
export function isQuoteCommerciallyLocked(quote: {
  document_type?: string | null;
  status?: string | null;
  sent_at?: string | null;
} | null | undefined): boolean {
  if (!quote) return false;
  if (quote.document_type === "proposta") return true;
  if (quote.sent_at) return true;
  return LOCKED_QUOTE_STATUSES.includes((quote.status ?? "") as (typeof LOCKED_QUOTE_STATUSES)[number]);
}

export const QUOTE_LOCKED_MESSAGE =
  "Esta proposta já foi enviada e está bloqueada para edição. Crie uma revisão para alterar condições, itens ou preços.";
