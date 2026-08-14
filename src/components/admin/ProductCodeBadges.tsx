/**
 * Badges de códigos do produto — usar SEMPRE abaixo do nome limpo.
 * Nunca reconcatenar o código ao nome.
 */
export function ProductCodeBadges({
  internalCode,
  manufacturerCode,
  sku,
  showSku = false,
  className = "",
}: {
  internalCode?: string | null;
  manufacturerCode?: string | null;
  sku?: string | null;
  showSku?: boolean;
  className?: string;
}) {
  const items: { label: string; value: string }[] = [];
  if (internalCode) items.push({ label: "Interno", value: internalCode });
  if (manufacturerCode) items.push({ label: "Fabricante", value: manufacturerCode });
  if (showSku && sku) items.push({ label: "SKU/Bling", value: sku });
  if (items.length === 0) return null;

  return (
    <div className={`mt-0.5 flex flex-wrap items-center gap-1 ${className}`}>
      {items.map((i) => (
        <span
          key={i.label}
          className="inline-flex items-center gap-1 rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          <span className="opacity-70">{i.label}:</span>
          <span className="font-mono text-foreground">{i.value}</span>
        </span>
      ))}
    </div>
  );
}
