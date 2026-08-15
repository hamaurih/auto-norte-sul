import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, type LucideIcon } from "lucide-react";

type StatTone = "blue" | "violet" | "emerald" | "amber" | "rose" | "cyan";

const toneStyles: Record<StatTone, { card: string; icon: string }> = {
  blue: { card: "border-blue-200/80 bg-gradient-to-br from-blue-50 to-white", icon: "bg-blue-100 text-blue-700" },
  violet: { card: "border-violet-200/80 bg-gradient-to-br from-violet-50 to-white", icon: "bg-violet-100 text-violet-700" },
  emerald: { card: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white", icon: "bg-emerald-100 text-emerald-700" },
  amber: { card: "border-amber-200/80 bg-gradient-to-br from-amber-50 to-white", icon: "bg-amber-100 text-amber-700" },
  rose: { card: "border-rose-200/80 bg-gradient-to-br from-rose-50 to-white", icon: "bg-rose-100 text-rose-700" },
  cyan: { card: "border-cyan-200/80 bg-gradient-to-br from-cyan-50 to-white", icon: "bg-cyan-100 text-cyan-700" },
};

export function AdminStatCard({
  label,
  value,
  to,
  icon: Icon,
  loading,
  hot,
  hint,
  tone = "blue",
}: {
  label: string;
  value: number | null;
  to: string;
  icon: LucideIcon;
  loading?: boolean;
  hot?: boolean;
  hint?: string;
  tone?: StatTone;
}) {
  const requiresAttention = hot && (value ?? 0) > 0;
  const style = toneStyles[tone];

  return (
    <Link
      to={to}
      className={`group relative flex min-h-32 flex-col overflow-hidden rounded-3xl border p-4 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        requiresAttention ? "border-rose-300 bg-gradient-to-br from-rose-100 to-orange-50" : style.card
      }`}
    >
      <span className={`grid size-10 place-items-center rounded-2xl ${requiresAttention ? "bg-rose-500 text-white" : style.icon}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
      {loading ? (
        <span className="mt-3 block h-8 w-16 animate-pulse rounded-xl bg-white/70" aria-label="Carregando" />
      ) : value === null ? (
        <span className="mt-3 flex items-center gap-1 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" /> indisponível
        </span>
      ) : (
        <span className="mt-3 font-display text-3xl font-extrabold tabular-nums">{value}</span>
      )}
      <span className="mt-auto truncate text-xs font-bold text-muted-foreground">{label}</span>
      {hint ? <span className="mt-0.5 truncate text-[10px] text-muted-foreground/75">{hint}</span> : null}
    </Link>
  );
}
