import {
  purchaseOrderStatusClass,
  purchaseOrderStatusLabel,
  receiptStatusClass,
  receiptStatusLabel,
} from "@/lib/supplies-ui";

export function SupplyStatusBadge({
  status,
  kind = "order",
}: {
  status: string;
  kind?: "order" | "receipt";
}) {
  const labels = kind === "order" ? purchaseOrderStatusLabel : receiptStatusLabel;
  const classes = kind === "order" ? purchaseOrderStatusClass : receiptStatusClass;
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        classes[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}
