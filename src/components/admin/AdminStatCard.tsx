import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, type LucideIcon } from "lucide-react";

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
  const requiresAttention = hot && (value ?? 0) > 0;

  return (
    <Link
      to={to}
      className={`group relative flex min-h-32 flex-col overflow-hidden rounded-2xl border p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        requiresAttention
          ? "border-primary/40 bg-primary/[0.06]"
          : "border-border/70 bg-card hover:border-foreground/15"
      }`}
    >
      <span className={`grid size-9 place-items-center rounded-xl ${requiresAttention ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
      {loading ? (
        <span className="mt-3 block h-8 w-16 animate-pulse rounded-lg bg-muted" aria-label="Carregando" />
      ) : value === null ? (
        <span className="mt-3 flex items-center gap-1 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" /> indisponível
        </span>
      ) : (
        <span className="mt-3 font-display text-3xl font-bold tabular-nums">{value}</span>
      )}
      <span className="mt-auto truncate text-xs font-semibold text-muted-foreground">{label}</span>
      {hint && <span className="mt-0.5 truncate text-[10px] text-muted-foreground/75">{hint}</span>}
    </Link>
  );
}
