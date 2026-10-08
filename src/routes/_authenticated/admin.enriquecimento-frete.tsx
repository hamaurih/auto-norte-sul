import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ExternalLink, PackageSearch, RefreshCw, Ruler, Scale, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { Button } from "@/components/ui/button";
import {
  approveShippingMeasurementCandidate,
  enqueueShippingMeasurementEnrichment,
  getShippingEnrichmentOverview,
  listShippingEnrichmentJobs,
  processShippingMeasurementEnrichment,
  rejectShippingMeasurementCandidate,
} from "@/lib/shipping-enrichment.functions";

export const Route = createFileRoute("/_authenticated/admin/enriquecimento-frete")({
  head: () => ({
    meta: [
      { title: "Peso e medidas · Admin" },
      { name: "description", content: "Pesquisa e revisão de peso e dimensões para cálculo de frete." },
    ],
  }),
  component: () => <SupplyGuard><ShippingEnrichmentPage /></SupplyGuard>,
});

function Metric({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-2xl border p-4 text-left transition ${active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"}`}>
    <div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="mt-1 font-display text-2xl font-extrabold">{value.toLocaleString("pt-BR")}</div>
  </button>;
}

function n(value: unknown, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toLocaleString("pt-BR", { maximumFractionDigits: digits }) : "—";
}

function ShippingEnrichmentPage() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(getShippingEnrichmentOverview);
  const listFn = useServerFn(listShippingEnrichmentJobs);
  const enqueueFn = useServerFn(enqueueShippingMeasurementEnrichment);
  const processFn = useServerFn(processShippingMeasurementEnrichment);
  const approveFn = useServerFn(approveShippingMeasurementCandidate);
  const rejectFn = useServerFn(rejectShippingMeasurementCandidate);
  const [status, setStatus] = useState("all");

  const overview = useQuery({ queryKey: ["shipping-enrichment-overview"], queryFn: () => overviewFn() });
  const jobs = useQuery({ queryKey: ["shipping-enrichment", status], queryFn: () => listFn({ data: { status } }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["shipping-enrichment"] });
    qc.invalidateQueries({ queryKey: ["shipping-enrichment-overview"] });
  };

  const enqueue = useMutation({
    mutationFn: () => enqueueFn({ data: { limit: 100 } }),
    onSuccess: (r) => { toast.success(`${r.count} produto(s) incluído(s) no piloto de peso e medidas.`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const process = useMutation({
    mutationFn: () => processFn({ data: { limit: 3 } }),
    onSuccess: (r) => {
      const review = r.results.filter((row) => row.status === "review").length;
      toast.success(`${r.processed} pesquisado(s); ${review} resultado(s) enviado(s) para revisão.`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const approve = useMutation({
    mutationFn: (candidateId: string) => approveFn({ data: { candidateId } }),
    onSuccess: (r) => { toast.success(`Aprovado. ${r.shipping_fields_applied ?? 0} campo(s) de frete preenchido(s).`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (candidateId: string) => rejectFn({ data: { candidateId } }),
    onSuccess: () => { toast.success("Sugestão rejeitada."); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const o = overview.data;
  const rows = (jobs.data ?? []) as any[];

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="admin-page-hero">
      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-violet-600/10 px-3 py-1 text-xs font-extrabold text-violet-700"><Ruler className="h-3.5 w-3.5" /> Frete e logística</span>
          <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight">Peso e medidas dos produtos</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">Pesquisa dados faltantes nas fontes oficiais dos fabricantes. Nesta fase piloto, todo resultado fica em revisão e somente campos vazios são preenchidos após aprovação.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={process.isPending} onClick={() => process.mutate()}><PackageSearch className="mr-2 h-4 w-4" />{process.isPending ? "Pesquisando…" : "Processar 3 agora"}</Button>
          <Button disabled={enqueue.isPending} onClick={() => enqueue.mutate()}><Scale className="mr-2 h-4 w-4" />{enqueue.isPending ? "Preparando…" : "Preparar piloto de 100"}</Button>
        </div>
      </div>
    </header>

    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Metric label="Ativos incompletos" value={o?.incomplete ?? 0} />
      <Metric label="Na fila" value={o?.queued ?? 0} active={status === "queued"} onClick={() => setStatus("queued")} />
      <Metric label="Processando" value={o?.processing ?? 0} active={status === "processing"} onClick={() => setStatus("processing")} />
      <Metric label="Em revisão" value={o?.review ?? 0} active={status === "review"} onClick={() => setStatus("review")} />
      <Metric label="Aprovados" value={o?.approved ?? 0} active={status === "approved"} onClick={() => setStatus("approved")} />
      <Metric label="Falhas" value={o?.failed ?? 0} active={status === "failed"} onClick={() => setStatus("failed")} />
    </section>

    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <strong>Regra de segurança:</strong> dados encontrados na internet não substituem peso ou medidas já cadastrados. Medidas identificadas como <b>embalagem/pacote</b> têm prioridade para frete; medidas físicas do produto ficam claramente sinalizadas para conferência humana.
    </section>

    <div className="flex flex-wrap items-center gap-2">
      {["all", "queued", "processing", "review", "approved", "failed"].map((value) => <button key={value} type="button" onClick={() => setStatus(value)} className={`rounded-full border px-3 py-2 text-xs font-extrabold uppercase ${status === value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background"}`}>
        {({ all: "Todos", queued: "Fila", processing: "Processando", review: "Revisão", approved: "Aprovados", failed: "Falhas" } as Record<string, string>)[value]}
      </button>)}
      <Button className="ml-auto" variant="ghost" size="sm" onClick={() => { void jobs.refetch(); void overview.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
    </div>

    {jobs.isLoading && <div className="rounded-3xl border p-8 text-center text-sm text-muted-foreground">Carregando fila de peso e medidas…</div>}
    {jobs.isError && <div role="alert" className="rounded-3xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">{(jobs.error as Error).message}</div>}

    <div className="space-y-4">
      {rows.map((job) => <article key={job.id} className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-lg font-extrabold">{job.product?.name}</h2><Status value={job.status} /></div>
            <p className="mt-1 text-xs text-muted-foreground">SKU {job.product?.sku || "—"} · GTIN {job.product?.gtin || "—"} · Cód. fabricante {job.product?.manufacturer_code || "—"}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <DataBox label="Peso atual" value={`${n(job.product?.weight_kg, 3)} kg`} />
              <DataBox label="Medidas atuais (C × L × A)" value={`${n(job.product?.length_cm)} × ${n(job.product?.width_cm)} × ${n(job.product?.height_cm)} cm`} />
            </div>
            {job.last_error && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-800">{job.last_error}</p>}
          </div>
        </div>

        {(job.candidates ?? []).map((candidate: any) => {
          const evidence = candidate.specifications?.shipping_measurements?.evidence ?? [];
          const basis = candidate.measurement_basis === "shipping_package" ? "Embalagem para frete" : candidate.measurement_basis === "product" ? "Produto físico" : "Não identificado";
          return <section key={candidate.id} className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2"><strong>{candidate.source_name || "Fonte oficial"}</strong><Status value={candidate.status} /></div>
                <p className="mt-1 text-xs text-muted-foreground">{basis} · confiança {Number(candidate.measurement_confidence ?? candidate.confidence ?? 0).toFixed(0)}%</p>
              </div>
              <a href={candidate.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Abrir fonte <ExternalLink className="h-3 w-3" /></a>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <DataBox label="Peso sugerido" value={`${n(candidate.suggested_weight_kg, 3)} kg`} />
              <DataBox label="Comprimento" value={`${n(candidate.suggested_length_cm)} cm`} />
              <DataBox label="Largura" value={`${n(candidate.suggested_width_cm)} cm`} />
              <DataBox label="Altura" value={`${n(candidate.suggested_height_cm)} cm`} />
            </div>
            {evidence.length > 0 && <div className="mt-3 rounded-xl border bg-background p-3"><div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Evidências extraídas da fonte</div><ul className="mt-2 space-y-1 text-xs">{evidence.map((item: string, index: number) => <li key={`${candidate.id}-${index}`}>• {item}</li>)}</ul></div>}
            {candidate.status === "pending" && <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" disabled={reject.isPending} onClick={() => reject.mutate(candidate.id)}><X className="mr-1 h-3.5 w-3.5" />Rejeitar</Button>
              <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(candidate.id)}><Check className="mr-1 h-3.5 w-3.5" />Aprovar e preencher campos vazios</Button>
            </div>}
          </section>;
        })}
      </article>)}
    </div>

    {!jobs.isLoading && rows.length === 0 && <div className="rounded-3xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum item nesta situação.</div>}
  </div>;
}

function DataBox({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-background p-3"><div className="text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-sm font-bold">{value}</div></div>;
}

function Status({ value }: { value: string }) {
  const labels: Record<string, string> = { queued: "Na fila", processing: "Processando", review: "Revisão", approved: "Aprovado", failed: "Falha", pending: "Pendente", rejected: "Rejeitado", cancelled: "Cancelado" };
  return <span className="h-fit rounded-full bg-muted px-2.5 py-1 text-[10px] font-extrabold uppercase">{labels[value] || value}</span>;
}
