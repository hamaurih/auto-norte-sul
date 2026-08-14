export const nfeStatusLabel: Record<string, string> = {
  importado: "Importado",
  em_conferencia: "Em conferência",
  divergente: "Divergente",
  pronto: "Pronto",
  confirmado: "Confirmado",
  cancelado: "Cancelado",
};

export const nfeStatusClass: Record<string, string> = {
  importado: "bg-muted text-muted-foreground",
  em_conferencia: "bg-primary/10 text-primary",
  divergente: "bg-hot/15 text-hot",
  pronto: "bg-primary/15 text-primary",
  confirmado: "bg-green-500/10 text-green-700",
  cancelado: "bg-destructive/10 text-destructive",
};

export const matchConfidenceLabel: Record<string, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
  pendente: "Pendente",
};

export const matchSourceLabel: Record<string, string> = {
  none: "Sem vínculo",
  gtin: "GTIN",
  manufacturer_code: "Cód. fabricante",
  sku: "SKU",
  internal_code: "Cód. interno",
  supplier_code: "Cód. do fornecedor",
  manual: "Manual",
};

export function formatAccessKey(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 44) return digits || "—";
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}
