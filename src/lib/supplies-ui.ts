export const purchaseOrderStatusLabel: Record<string, string> = {
  draft: "Rascunho",
  approved: "Aprovado",
  sent: "Enviado",
  partially_received: "Parcialmente recebido",
  received: "Recebido",
  cancelled: "Cancelado",
};

export const purchaseOrderStatusClass: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-primary/10 text-primary",
  sent: "bg-primary/10 text-primary",
  partially_received: "bg-hot/15 text-hot",
  received: "bg-green-500/10 text-green-700",
  cancelled: "bg-destructive/10 text-destructive",
};

export const receiptStatusLabel: Record<string, string> = {
  draft: "Em conferência",
  confirmed: "Confirmado",
  reversed: "Estornado",
};

export const receiptStatusClass: Record<string, string> = {
  draft: "bg-hot/15 text-hot",
  confirmed: "bg-green-500/10 text-green-700",
  reversed: "bg-destructive/10 text-destructive",
};

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR");
}

export function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function qty(value: unknown): string {
  return num(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}
