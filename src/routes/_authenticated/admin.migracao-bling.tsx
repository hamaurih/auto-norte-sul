import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  FileText,
  Landmark,
  Package,
  RefreshCcw,
  ShieldCheck,
  ShoppingCart,
  Users,
  Warehouse,
} from "lucide-react";
import { activeTenant, fetchAccessContext } from "@/lib/access";
import {
  getMigrationCenter,
  refreshMigrationReconciliation,
  retryMigrationModule,
} from "@/lib/migration-center.functions";

export const Route = createFileRoute("/_authenticated/admin/migracao-bling")({
  head: () => ({ meta: [{ title: "Central de Migração Bling · Norte Sul" }] }),
  beforeLoad: async () => {
    const context = await fetchAccessContext();
    if (!context.user_id) throw redirect({ to: "/auth" });
    const tenant = activeTenant(context);
    if (!tenant) throw redirect({ to: "/ativacao" });
    if (tenant.role !== "owner" && tenant.role !== "admin") throw redirect({ to: "/admin" });
  },
  component: MigrationCenterPage,
});

type ModuleKey =
  | "contacts"
  | "products"
  | "purchase_orders"
  | "sales_orders"
  | "cash_bank"
  | "accounts_receivable"
  | "accounts_payable"
  | "stock"
  | "nfe";

const moduleLabels: Record<ModuleKey, { label: string; icon: typeof Package; note: string }> = {
  contacts: { label: "Contatos", icon: Users, note: "Clientes, fornecedores e demais papéis serão classificados antes da gravação." },
  products: { label: "Produtos", icon: Package, note: "Correspondência por IDs externos, SKU/código e regras de duplicidade." },
  purchase_orders: { label: "Pedidos de compra", icon: ShoppingCart, note: "Cabeçalho e itens serão reconciliados como entidades relacionadas." },
  sales_orders: { label: "Pedidos de venda", icon: ShoppingCart, note: "Histórico preservado sem transformar o Bling em fonte oficial." },
  cash_bank: { label: "Caixa e bancos", icon: Landmark, note: "Movimentos históricos ficam separados do caixa operacional até o mapeamento contábil." },
  accounts_receivable: { label: "Contas a receber", icon: Landmark, note: "Títulos serão migrados apenas para o modelo financeiro definitivo." },
  accounts_payable: { label: "Contas a pagar", icon: Landmark, note: "Títulos serão migrados apenas para o modelo financeiro definitivo." },
  stock: { label: "Estoque e depósitos", icon: Warehouse, note: "Os 9 depósitos serão classificados antes de alterar product_stock." },
  nfe: { label: "NF-e / XML", icon: FileText, note: "Deduplicação por conteúdo e chave de acesso antes da persistência fiscal." },
};

const statusLabel: Record<string, string> = {
  analyzed: "Analisado",
  pending: "Pendente",
  staging: "Preparando staging",
  ready: "Pronto",
  running: "Migrando",
  paused: "Pausado",
  completed: "Concluído",
  completed_with_errors: "Concluído com erros",
  reconciled: "Reconciliado",
  error: "Erro",
  cancelled: "Cancelado",
};

function n(value: unknown) {
  return Number(value ?? 0);
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("pt-BR").format(n(value));
}

function processed(module: any) {
  return (
    n(module.matched_count) +
    n(module.created_count) +
    n(module.updated_count) +
    n(module.skipped_count) +
    n(module.error_count) +
    n(module.quarantined_count)
  );
}

function progress(module: any) {
  const expected = n(module.source_entities);
  if (!expected) return 0;
  return Math.min(100, Math.round((processed(module) / expected) * 100));
}

function statusClass(status: string) {
  if (status === "completed" || status === "reconciled" || status === "match") return "bg-emerald-100 text-emerald-800";
  if (status === "error" || status === "mismatch") return "bg-red-100 text-red-800";
  if (status === "running" || status === "ready") return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
}

function MigrationCenterPage() {
  const queryClient = useQueryClient();
  const center = useQuery({ queryKey: ["migration-center"], queryFn: () => getMigrationCenter() });
  const data: any = center.data;
  const batch = data?.activeBatch;

  const refresh = useMutation({
    mutationFn: () => refreshMigrationReconciliation({ data: { batchId: batch.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["migration-center"] });
      toast.success("Reconciliação atualizada.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const retry = useMutation({
    mutationFn: (moduleKey: ModuleKey) => retryMigrationModule({ data: { batchId: batch.id, moduleKey } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["migration-center"] });
      toast.success("Pendências retornaram ao staging para reprocessamento.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (center.isLoading) return <p className="text-sm text-muted-foreground">Carregando Central de Migração…</p>;
  if (center.error) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
        <h1 className="font-display text-2xl font-bold uppercase">Central de Migração</h1>
        <p className="mt-2 text-sm text-destructive">{(center.error as Error).message}</p>
      </div>
    );
  }
  if (!batch) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <h1 className="font-display text-3xl font-bold uppercase">Central de Migração Bling → Norte Sul</h1>
        <p className="mt-2 text-sm text-muted-foreground">Nenhum backup foi catalogado neste ambiente.</p>
      </div>
    );
  }

  const manifest = batch.manifest ?? {};
  const modules = data.modules ?? [];
  const reconciliations = data.reconciliations ?? [];
  const allRows = data.summary?.sourceRows ?? 0;
  const allEntities = data.summary?.sourceEntities ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold uppercase text-emerald-800">
              ERP Norte Sul = fonte oficial
            </span>
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${statusClass(batch.status)}`}>
              {statusLabel[batch.status] ?? batch.status}
            </span>
          </div>
          <h1 className="font-display text-3xl font-bold uppercase">Central de Migração Bling → Norte Sul</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Migração histórica auditável, idempotente e por módulo. Nenhum dado do backup sobrescreve o ERP sem staging, validação e reconciliação.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-bold disabled:opacity-50"
        >
          <RefreshCcw className={`h-4 w-4 ${refresh.isPending ? "animate-spin" : ""}`} />
          Atualizar reconciliação
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Linhas no backup" value={formatNumber(allRows)} icon={Archive} />
        <SummaryCard label="Entidades identificadas" value={formatNumber(allEntities)} icon={Database} />
        <SummaryCard label="Processadas" value={formatNumber(data.summary?.processed)} icon={CheckCircle2} />
        <SummaryCard label="Erros" value={formatNumber(data.summary?.errors)} icon={AlertTriangle} />
        <SummaryCard label="Quarentena" value={formatNumber(data.summary?.quarantined)} icon={ShieldCheck} />
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold uppercase">Backup catalogado</h2>
            <p className="mt-1 truncate text-sm font-semibold">{batch.source_name}</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">SHA-256 {batch.source_sha256}</p>
          </div>
          <div className="text-left text-sm lg:text-right">
            <p><strong>{(n(batch.source_size_bytes) / 1024 / 1024).toFixed(2)} MB</strong></p>
            <p className="text-muted-foreground">Analisado em {new Date(batch.analyzed_at).toLocaleString("pt-BR")}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
          <span>10 arquivos/pacotes principais</span>
          <span>{formatNumber(manifest.nfe_xml_files)} XMLs NF-e</span>
          <span>{formatNumber(manifest.nfe_unique_xml)} XMLs únicos</span>
          <span>{formatNumber(manifest.nfe_duplicate_content)} duplicidades de conteúdo</span>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-2xl font-bold uppercase">Migração por módulo</h2>
          <p className="text-sm text-muted-foreground">O progresso considera entidades do ledger, não apenas linhas do CSV.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {modules.map((module: any) => {
            const key = module.module_key as ModuleKey;
            const config = moduleLabels[key] ?? { label: key, icon: Database, note: "" };
            const Icon = config.icon;
            const pct = progress(module);
            const hasFailures = n(module.error_count) + n(module.quarantined_count) > 0;
            const rec = reconciliations.filter((item: any) => item.module_key === key);
            return (
              <article key={module.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-muted p-2"><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-bold uppercase">{config.label}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${statusClass(module.status)}`}>
                        {statusLabel[module.status] ?? module.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{config.note}</p>
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>{formatNumber(processed(module))} / {formatNumber(module.source_entities)} entidades</span>
                  <span>{pct}%</span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
                  <Counter label="Linhas" value={module.source_rows} />
                  <Counter label="Staging" value={module.staged_count} />
                  <Counter label="Criados" value={module.created_count} />
                  <Counter label="Atualizados" value={module.updated_count} />
                  <Counter label="Erros" value={module.error_count} />
                  <Counter label="Quarentena" value={module.quarantined_count} />
                </div>

                {rec.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-border/70 pt-3">
                    {rec.map((item: any) => (
                      <div key={item.id} className="flex items-start gap-2 text-xs">
                        {item.status === "match" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        )}
                        <div>
                          <p className="font-semibold">{item.metric_key === "baseline_before_import" ? "Linha de base" : "Cobertura do ledger"}</p>
                          <p className="text-muted-foreground">{item.details}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {hasFailures && (
                  <button
                    type="button"
                    onClick={() => retry.mutate(key)}
                    disabled={retry.isPending}
                    className="mt-4 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-bold uppercase disabled:opacity-50"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" /> Reprocessar erros do módulo
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-xl font-bold uppercase">Pendências e erros</h2>
          {(data.errors ?? []).length === 0 ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Nenhum registro em erro ou quarentena.
            </div>
          ) : (
            <ul className="mt-4 space-y-2 text-xs">
              {(data.errors ?? []).map((item: any) => (
                <li key={item.id} className="rounded-md border border-border p-3">
                  <strong>{moduleLabels[item.module_key as ModuleKey]?.label ?? item.module_key}</strong>
                  <span className="ml-2 uppercase text-destructive">{item.status}</span>
                  <p className="mt-1 text-muted-foreground">{item.error_code ?? "erro"}: {item.error_message ?? "Sem detalhe"}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-display text-xl font-bold uppercase">Trilha de execução</h2>
          {(data.attempts ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">A importação ainda não foi iniciada. O lote está somente analisado e catalogado.</p>
          ) : (
            <ul className="mt-4 space-y-2 text-xs">
              {(data.attempts ?? []).map((item: any) => (
                <li key={item.id} className="flex gap-3 border-b border-border/60 pb-2 last:border-0">
                  <span className="font-bold uppercase">{item.action}</span>
                  <span className="text-muted-foreground">{item.message ?? item.status}</span>
                  <span className="ml-auto whitespace-nowrap text-muted-foreground">{new Date(item.started_at).toLocaleString("pt-BR")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-amber-300/60 bg-amber-50 p-5 text-amber-950">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-bold uppercase">Regra de corte</h2>
            <p className="mt-1 text-sm">
              Este lote está em análise segura. O Bling permanece apenas como origem histórica do backup; produtos, preços, estoque, pedidos e clientes continuam tendo o ERP Norte Sul como fonte oficial. Nenhuma divergência será corrigida por sobrescrita automática.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Database }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground"><Icon className="h-4 w-4" /> {label}</div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-2">
      <p className="font-bold">{formatNumber(value)}</p>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
    </div>
  );
}
