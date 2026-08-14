import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AlertTriangle, PackageSearch, Save, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listReplenishmentSuggestions,
  listSuppliers,
  upsertReplenishmentSetting,
  type ReplenishmentRisk,
} from "@/lib/supplies.functions";
import { brl } from "@/lib/format";
import { qty } from "@/lib/supplies-ui";

export const Route = createFileRoute("/_authenticated/admin/reposicao")({
  head: () => ({
    meta: [
      { title: "Reposição inteligente · Admin" },
      { name: "description", content: "Sugestões de compra baseadas em demanda, estoque e prazo do fornecedor." },
    ],
  }),
  component: ReposicaoGuardedPage,
});

const filters: Array<{ key: ReplenishmentRisk | "all"; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "ruptura", label: "Ruptura" },
  { key: "comprar", label: "Comprar" },
  { key: "excesso", label: "Excesso" },
  { key: "saudavel", label: "Saudável" },
];

type EditState = {
  productId: string;
  preferredSupplierId: string;
  maxStock: string;
  safetyStock: string;
  leadTimeDays: string;
  reviewPeriodDays: string;
};

function ReposicaoGuardedPage() {
  return (
    <SupplyGuard>
      <ReposicaoPage />
    </SupplyGuard>
  );
}

function ReposicaoPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listReplenishmentSuggestions);
  const suppliersFn = useServerFn(listSuppliers);
  const saveFn = useServerFn(upsertReplenishmentSetting);
  const [risk, setRisk] = useState<ReplenishmentRisk | "all">("all");
  const [lookbackDays, setLookbackDays] = useState(90);
  const [edit, setEdit] = useState<EditState | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["replenishment-suggestions", lookbackDays, risk],
    queryFn: () => listFn({ data: { lookbackDays, risk } }),
  });
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers", "active-only"],
    queryFn: () => suppliersFn({ data: { onlyActive: true } }),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!edit) throw new Error("Selecione um produto");
      const optional = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));
      return saveFn({
        data: {
          productId: edit.productId,
          preferredSupplierId: edit.preferredSupplierId || null,
          maxStock: optional(edit.maxStock),
          safetyStock: Number(edit.safetyStock.replace(",", ".")) || 0,
          leadTimeDays: optional(edit.leadTimeDays),
          reviewPeriodDays: Number(edit.reviewPeriodDays) || 14,
        },
      });
    },
    onSuccess: () => {
      toast.success("Parâmetros de reposição atualizados");
      setEdit(null);
      qc.invalidateQueries({ queryKey: ["replenishment-suggestions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = (data ?? []) as any[];
  const totals = {
    rupture: rows.filter((row) => row.risk_status === "ruptura").length,
    buy: rows.filter((row) => row.risk_status === "comprar").length,
    excess: rows.filter((row) => row.risk_status === "excesso").length,
    value: rows.reduce((sum, row) => sum + Number(row.estimated_purchase_value ?? 0), 0),
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase">Reposição inteligente</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Demanda histórica + estoque disponível + compras pendentes + prazo do fornecedor + estoque de segurança.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Risco de ruptura" value={String(totals.rupture)} icon={AlertTriangle} tone="text-destructive" />
        <Metric label="Comprar agora" value={String(totals.buy)} icon={TrendingDown} tone="text-amber-600" />
        <Metric label="Estoque excessivo" value={String(totals.excess)} icon={TrendingUp} tone="text-blue-600" />
        <Metric label="Compra estimada" value={brl(totals.value)} icon={PackageSearch} tone="text-primary" />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setRisk(filter.key)}
            className={`min-h-9 rounded-md border px-3 text-xs font-semibold uppercase transition-colors ${
              risk === filter.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
            }`}
          >
            {filter.label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          Histórico
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={lookbackDays}
            onChange={(event) => setLookbackDays(Number(event.target.value))}
          >
            <option value={30}>30 dias</option>
            <option value={60}>60 dias</option>
            <option value={90}>90 dias</option>
            <option value={180}>180 dias</option>
          </select>
        </label>
      </div>

      {isError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
          {(error as Error)?.message ?? "Não foi possível calcular a reposição."}
        </div>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">Calculando sugestões…</p>}

      {!isLoading && !isError && rows.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Nenhum produto encontrado neste filtro.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3 text-left">Produto</th>
                <th className="p-3 text-right">Disponível</th>
                <th className="p-3 text-right">Em compra</th>
                <th className="p-3 text-right">Venda/dia</th>
                <th className="p-3 text-right">Cobertura</th>
                <th className="p-3 text-right">Reposição</th>
                <th className="p-3 text-left">Fornecedor</th>
                <th className="p-3 text-right">Estimativa</th>
                <th className="p-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product_id} className="border-t border-border">
                  <td className="p-3">
                    <div className="font-semibold">{row.product_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[row.sku, row.internal_code && `Interno: ${row.internal_code}`].filter(Boolean).join(" · ")}
                    </div>
                    <RiskBadge status={row.risk_status} />
                  </td>
                  <td className="p-3 text-right">{qty(row.available_qty)}</td>
                  <td className="p-3 text-right">{qty(row.pending_purchase_qty)}</td>
                  <td className="p-3 text-right">{qty(row.avg_daily_demand)}</td>
                  <td className="p-3 text-right">
                    {row.days_of_cover == null ? "Sem giro" : `${Number(row.days_of_cover).toFixed(0)} dias`}
                  </td>
                  <td className="p-3 text-right font-bold">{qty(row.suggested_qty)}</td>
                  <td className="p-3">{row.preferred_supplier_name ?? "Não definido"}</td>
                  <td className="p-3 text-right">{brl(Number(row.estimated_purchase_value ?? 0))}</td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEdit({
                          productId: row.product_id,
                          preferredSupplierId: row.preferred_supplier_id ?? "",
                          maxStock: String(row.target_stock ?? ""),
                          safetyStock: String(row.safety_stock ?? 0),
                          leadTimeDays: String(row.lead_time_days ?? 7),
                          reviewPeriodDays: "14",
                        })
                      }
                    >
                      Configurar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <section className="rounded-lg border border-primary/40 bg-card p-4">
          <h2 className="font-display text-lg font-bold uppercase">Parâmetros do produto</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <select
              aria-label="Fornecedor preferencial"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={edit.preferredSupplierId}
              onChange={(event) => setEdit({ ...edit, preferredSupplierId: event.target.value })}
            >
              <option value="">Fornecedor preferencial</option>
              {(suppliers ?? []).map((supplier: any) => (
                <option key={supplier.id} value={supplier.id}>{supplier.legal_name}</option>
              ))}
            </select>
            <Input aria-label="Estoque máximo" placeholder="Estoque máximo" value={edit.maxStock} onChange={(e) => setEdit({ ...edit, maxStock: e.target.value })} />
            <Input aria-label="Estoque de segurança" placeholder="Estoque segurança" value={edit.safetyStock} onChange={(e) => setEdit({ ...edit, safetyStock: e.target.value })} />
            <Input aria-label="Prazo em dias" placeholder="Prazo fornecedor" value={edit.leadTimeDays} onChange={(e) => setEdit({ ...edit, leadTimeDays: e.target.value })} />
            <Input aria-label="Período de revisão" placeholder="Revisão em dias" value={edit.reviewPeriodDays} onChange={(e) => setEdit({ ...edit, reviewPeriodDays: e.target.value })} />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              <Save className="mr-2 h-4 w-4" aria-hidden="true" />
              {save.isPending ? "Salvando…" : "Salvar parâmetros"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof PackageSearch; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Icon className={`h-5 w-5 ${tone}`} aria-hidden="true" />
      <div className="mt-2 font-display text-2xl font-bold">{value}</div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function RiskBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    ruptura: "bg-destructive/10 text-destructive",
    comprar: "bg-amber-500/10 text-amber-700",
    excesso: "bg-blue-500/10 text-blue-700",
    saudavel: "bg-emerald-500/10 text-emerald-700",
  };
  const labels: Record<string, string> = {
    ruptura: "Ruptura",
    comprar: "Comprar",
    excesso: "Excesso",
    saudavel: "Saudável",
  };
  return (
    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${classes[status] ?? ""}`}>
      {labels[status] ?? status}
    </span>
  );
}
