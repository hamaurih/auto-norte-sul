import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, type LucideIcon } from "lucide-react";

export function AdminStatCard({
  label,
  value,
  to,
  icon: Icon,
  loading,
  hot,
  hint,
}: {
  label: string;
  value: number | null;
  to: string;
  icon: LucideIcon;
  loading?: boolean;
  hot?: boolean;
  hint?: string;
}) {
  return (
    <Link
      to={to}
      className={`group flex min-h-11 flex-col rounded-lg border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        hot && (value ?? 0) > 0
          ? "border-primary bg-primary/5 hover:bg-primary/10"
          : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="min-w-0 truncate">{label}</span>
        <ArrowRight className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </span>
      {loading ? (
        <span className="mt-2 block h-8 w-16 animate-pulse rounded bg-muted" aria-label="Carregando" />
      ) : value === null ? (
        <span className="mt-1 flex items-center gap-1 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" /> indisponível
        </span>
      ) : (
        <span className="mt-1 font-display text-3xl font-bold">{value}</span>
      )}
      {hint && <span className="mt-1 text-xs text-muted-foreground">{hint}</span>}
    </Link>
  );
}
