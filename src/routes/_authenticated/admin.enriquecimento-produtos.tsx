import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check, ExternalLink, ImageDown, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addProductEnrichmentCandidate,
  approveProductEnrichmentCandidate,
  copyProductEnrichmentImage,
  enqueueMissingProductEnrichment,
  getEnrichmentOverview,
  listProductEnrichmentJobs,
  processManufacturerEnrichment,
  rejectProductEnrichmentCandidate,
} from "@/lib/product-enrichment.functions";
import { setProductEnrichmentItemSelection, type EnrichmentSelectionKind } from "@/lib/product-enrichment-selection.functions";

export const Route = createFileRoute("/_authenticated/admin/enriquecimento-produtos")({
  head: () => ({ meta: [
    { title: "Enriquecimento de produtos · Admin" },
    { name: "description", content: "Automação e revisão de imagens, aplicações, descrições, GTIN e códigos com fonte auditável." },
  ] }),
  component: () => <SupplyGuard><EnrichmentPage /></SupplyGuard>,
});

const emptyForm = {
  sourceType: "manufacturer", sourceUrl: "", imageUrl: "", licenseName: "",
  suggestedName: "", shortDescription: "", description: "", gtin: "", manufacturerCode: "", confidence: "80",
};

function Metric({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-lg border p-3 text-left transition ${active ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"}`}>
    <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
    <div className="mt-1 text-2xl font-bold">{value.toLocaleString("pt-BR")}</div>
  </button>;
}

function EnrichmentPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listProductEnrichmentJobs);
  const overviewFn = useServerFn(getEnrichmentOverview);
  const enqueueFn = useServerFn(enqueueMissingProductEnrichment);
  const processFn = useServerFn(processManufacturerEnrichment);
  const addFn = useServerFn(addProductEnrichmentCandidate);
  const copyFn = useServerFn(copyProductEnrichmentImage);
  const approveFn = useServerFn(approveProductEnrichmentCandidate);
  const rejectFn = useServerFn(rejectProductEnrichmentCandidate);
  const selectionFn = useServerFn(setProductEnrichmentItemSelection);
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);

  const overview = useQuery({ queryKey: ["product-enrichment-overview"], queryFn: () => overviewFn() });
  const jobs = useQuery({ queryKey: ["product-enrichment", status], queryFn: () => listFn({ data: { status } }) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["product-enrichment"] });
    qc.invalidateQueries({ queryKey: ["product-enrichment-overview"] });
  };

  const enqueue = useMutation({
    mutationFn: () => enqueueFn({ data: { limit: 100 } }),
    onSuccess: (r) => { toast.success(`${r.count} produto(s) incluído(s) na fila`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const process = useMutation({
    mutationFn: () => processFn({ data: { limit: 3 } }),
    onSuccess: (r) => {
      const review = r.results.filter((v) => v.status === "review").length;
      const gallery = r.results.reduce((sum, value) => sum + Number(value.galleryImages ?? 0), 0);
      const applications = r.results.reduce((sum, value) => sum + Number(value.applications ?? 0), 0);
      toast.success(`${r.processed} processado(s); ${review} em revisão · ${gallery} imagem(ns) · ${applications} aplicação(ões)`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const add = useMutation({
    mutationFn: () => addFn({ data: {
      jobId: editing.id, productId: editing.product.id, sourceType: form.sourceType as any, sourceUrl: form.sourceUrl,
      imageUrl: form.imageUrl || undefined, licenseName: form.licenseName || undefined, suggestedName: form.suggestedName || undefined,
      shortDescription: form.shortDescription || undefined, description: form.description || undefined, gtin: form.gtin || undefined,
      manufacturerCode: form.manufacturerCode || undefined, confidence: Number(form.confidence) || 0,
      matchReasons: ["Revisão manual com fonte registrada"],
    } }),
    onSuccess: () => { toast.success("Sugestão registrada"); setEditing(null); setForm(emptyForm); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const selection = useMutation({
    mutationFn: (input: { candidateId: string; kind: EnrichmentSelectionKind; itemIds?: string[]; selected: boolean }) => selectionFn({ data: input }),
    onSuccess: (r) => { toast.success(`${r.selected} de ${r.total} ${r.kind === "image" ? "foto(s)" : "aplicação(ões)"} selecionada(s)`); refresh(); },
    onError: (e: Error) => { toast.error(e.message); refresh(); },
  });
  const copy = useMutation({
    mutationFn: (id: string) => copyFn({ data: { candidateId: id } }),
    onSuccess: (r) => { toast.success(r.total > 1 ? `Galeria selecionada copiada (${r.total} imagens)` : r.total === 1 ? "Imagem selecionada copiada" : "Nenhuma imagem selecionada"); refresh(); },
    onError: (e: Error) => { toast.error(e.message); refresh(); },
  });
  const approve = useMutation({
    mutationFn: (id: string) => approveFn({ data: { candidateId: id } }),
    onSuccess: (r) => { toast.success(`Aprovado · ${r.images_added ?? 0} imagem(ns) · ${r.applications_added ?? 0} aplicação(ões)`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectFn({ data: { candidateId: id } }),
    onSuccess: () => { toast.success("Sugestão rejeitada"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (jobs.data ?? []) as any[];
  const o = overview.data;
  const lastRun = o?.lastRun;

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold uppercase">Enriquecimento de produtos</h1>
        <p className="mt-1 max-w-4xl text-sm text-muted-foreground">O robô trabalha em segundo plano usando somente fontes oficiais cadastradas. Esta tela serve principalmente para acompanhar o motor e revisar exceções antes de qualquer dado duvidoso entrar no catálogo.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={process.isPending} onClick={() => process.mutate()}><Search className="mr-2 h-4 w-4" />{process.isPending ? "Consultando fontes…" : "Processar agora"}</Button>
        <Button variant="outline" disabled={enqueue.isPending} onClick={() => enqueue.mutate()}><Search className="mr-2 h-4 w-4" />{enqueue.isPending ? "Preparando…" : "Enfileirar agora"}</Button>
      </div>
    </header>

    <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <Metric label="Na fila" value={o?.queued ?? 0} active={status === "queued"} onClick={() => setStatus("queued")} />
      <Metric label="Processando" value={o?.processing ?? 0} active={status === "processing"} onClick={() => setStatus("processing")} />
      <Metric label="Em revisão" value={o?.review ?? 0} active={status === "review"} onClick={() => setStatus("review")} />
      <Metric label="Autoaprovados" value={o?.approvedAuto ?? 0} active={status === "approved"} onClick={() => setStatus("approved")} />
      <Metric label="Aprovados manual" value={o?.approvedManual ?? 0} active={status === "approved"} onClick={() => setStatus("approved")} />
      <Metric label="Falhas" value={o?.failed ?? 0} active={status === "failed"} onClick={() => setStatus("failed")} />
    </section>

    <section className={`rounded-lg border p-4 text-sm ${o?.automationConfigured ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
      <div className="font-semibold">{o?.automationConfigured ? "Automação ativa" : "Automação aguardando configuração do CRON_SECRET"}</div>
      {lastRun ? <div className="mt-1 text-xs text-muted-foreground">
        Último ciclo: {new Date(lastRun.started_at).toLocaleString("pt-BR")} · {lastRun.status === "completed" ? "concluído" : lastRun.status} · {lastRun.processed} processado(s) · {lastRun.auto_approved} autoaprovado(s) · {lastRun.sent_review} para revisão · {lastRun.failed} falha(s).
        {lastRun.last_error ? <span className="text-destructive"> Erro: {lastRun.last_error}</span> : null}
      </div> : <div className="mt-1 text-xs text-muted-foreground">Nenhum ciclo automático registrado ainda.</div>}
    </section>

    <div className="flex flex-wrap gap-2">
      {["all", "queued", "processing", "review", "approved", "failed"].map((value) => <button key={value} onClick={() => setStatus(value)} className={`rounded-md border px-3 py-2 text-xs font-bold uppercase ${status === value ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
        {({ all: "Todos", queued: "Na fila", processing: "Processando", review: "Revisão", approved: "Aprovados", failed: "Falhas" } as Record<string,string>)[value]}
      </button>)}
    </div>

    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><strong>Revisão seletiva:</strong> casos com conflito de GTIN/código, fonte não autorizada, imagem ainda externa ou aplicação ambígua não são autoaprovados. Desmarque qualquer foto ou aplicação incorreta; somente os itens selecionados serão promovidos.</div>

    {jobs.isLoading && <p className="text-sm text-muted-foreground">Carregando fila…</p>}
    {jobs.isError && <div role="alert" className="rounded-lg border border-destructive p-4 text-sm">{(jobs.error as Error).message}</div>}

    <div className="space-y-4">{rows.map((job) => <article key={job.id} className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{job.product?.name}</span>{job.approval_mode === "auto" && <Badge>Autoaprovado</Badge>}{job.approval_mode === "manual" && <Badge>Manual</Badge>}</div>
          <div className="text-xs text-muted-foreground">SKU {job.product?.sku} · GTIN {job.product?.gtin || "não informado"} · Fabricante {job.product?.manufacturer_code || "não informado"}</div>
          <div className="mt-1 text-xs">Busca sugerida: <code>{job.search_query}</code></div>
          {job.last_error && <div className="mt-1 text-xs text-destructive">{job.last_error}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Status value={job.status} />
          <a href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(job.search_query || job.product?.name || "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md border px-3 py-2 text-xs font-semibold">Pesquisa manual <ExternalLink className="ml-1 h-3 w-3" /></a>
          <Button size="sm" variant="outline" onClick={() => { setEditing(job); setForm({ ...emptyForm, suggestedName: job.product?.name || "", gtin: job.product?.gtin || "", manufacturerCode: job.product?.manufacturer_code || "" }); }}><Plus className="mr-1 h-3 w-3" />Sugestão manual</Button>
        </div>
      </div>
      {(job.candidates ?? []).length > 0 && <div className="mt-4 grid gap-3 lg:grid-cols-2">{job.candidates.map((c: any) => <CandidateCard key={c.id} candidate={c} selectionBusy={selection.isPending} onSelection={(candidateId, kind, itemIds, selected) => selection.mutate({ candidateId, kind, itemIds, selected })} onCopy={(id) => copy.mutate(id)} onApprove={(id) => approve.mutate(id)} onReject={(id) => reject.mutate(id)} />)}</div>}
    </article>)}</div>

    {rows.length === 0 && !jobs.isLoading && <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum produto nesta situação.</div>}

    {editing && <section className="rounded-lg border border-primary/40 bg-card p-4">
      <h2 className="font-display text-lg font-bold uppercase">Nova sugestão · {editing.product?.name}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="URL da fonte *" value={form.sourceUrl} onChange={(v) => setForm({ ...form, sourceUrl: v })} />
        <Field label="URL da imagem" value={form.imageUrl} onChange={(v) => setForm({ ...form, imageUrl: v })} />
        <label className="text-xs font-semibold uppercase text-muted-foreground">Tipo da fonte<select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}><option value="manufacturer">Fabricante</option><option value="supplier">Fornecedor</option><option value="authorized_distributor">Distribuidor autorizado</option><option value="gs1">GS1</option><option value="web">Internet</option><option value="manual">Manual</option><option value="bling">Bling (temporário)</option></select></label>
        <Field label="Licença/autorização" value={form.licenseName} onChange={(v) => setForm({ ...form, licenseName: v })} />
        <Field label="Nome sugerido" value={form.suggestedName} onChange={(v) => setForm({ ...form, suggestedName: v })} />
        <Field label="Descrição curta" value={form.shortDescription} onChange={(v) => setForm({ ...form, shortDescription: v })} />
        <Field label="GTIN" value={form.gtin} onChange={(v) => setForm({ ...form, gtin: v })} />
        <Field label="Código fabricante" value={form.manufacturerCode} onChange={(v) => setForm({ ...form, manufacturerCode: v })} />
        <Field label="Confiança (0–100)" value={form.confidence} onChange={(v) => setForm({ ...form, confidence: v })} />
        <label className="text-xs font-semibold uppercase text-muted-foreground sm:col-span-2">Descrição completa<textarea className="mt-1 min-h-28 w-full rounded-md border bg-background p-3 text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button disabled={add.isPending || !form.sourceUrl} onClick={() => add.mutate()}>Salvar para revisão</Button></div>
    </section>}
  </div>;
}

function CandidateCard({ candidate: c, selectionBusy, onSelection, onCopy, onApprove, onReject }: {
  candidate: any;
  selectionBusy: boolean;
  onSelection: (candidateId: string, kind: EnrichmentSelectionKind, itemIds: string[] | undefined, selected: boolean) => void;
  onCopy: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const gallery = ([...(c.gallery ?? [])] as any[]).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(a.sort_order) - Number(b.sort_order));
  const selectedGallery = gallery.filter((item) => item.selected !== false);
  const applications = ([...(c.applications ?? [])] as any[]);
  const selectedApplications = applications.filter((item) => item.selected !== false);
  const missingGallery = selectedGallery.filter((item) => !item.storage_url).length;
  const legacyNeedsCopy = gallery.length === 0 && Boolean(c.image_url && !c.storage_url);
  const needsCopy = missingGallery > 0 || legacyNeedsCopy;
  const primary = selectedGallery[0]?.storage_url || selectedGallery[0]?.source_url || gallery[0]?.storage_url || gallery[0]?.source_url || c.storage_url || c.image_url;
  const editable = c.status === "pending";

  return <div className="rounded-md border border-border p-3">
    <div className="flex flex-wrap justify-between gap-2">
      <div>
        <div className="flex flex-wrap items-center gap-2"><strong>{c.source_name || c.source_type}</strong>{c.auto_approved && <Badge>Autoaprovado</Badge>}</div>
        <div className="text-xs text-muted-foreground">Fonte {c.source_type === "manufacturer" ? "oficial do fabricante" : c.source_type} · Confiança {Number(c.confidence).toFixed(0)}% · {c.license_name || "licença não informada"}</div>
        <div className="mt-1 flex flex-wrap gap-1">{gallery.length > 0 && <Badge>{selectedGallery.length}/{gallery.length} foto(s)</Badge>}{applications.length > 0 && <Badge>{selectedApplications.length}/{applications.length} aplicação(ões)</Badge>}</div>
      </div>
      <Status value={c.status} />
    </div>

    {c.review_reason && <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs"><strong>Requer revisão:</strong> {c.review_reason}</div>}

    {gallery.length > 0 ? <section className="mt-3 rounded-md border p-2">
      <div className="mb-2 flex items-center justify-between gap-2"><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Galeria oficial</div>{editable && <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold"><input type="checkbox" disabled={selectionBusy} checked={selectedGallery.length === gallery.length && gallery.length > 0} onChange={(e) => onSelection(c.id, "image", undefined, e.target.checked)} />Selecionar todas</label>}</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{gallery.map((image) => <label key={image.id} className={`relative aspect-square overflow-hidden rounded border bg-muted ${image.selected === false ? "opacity-40" : "ring-1 ring-primary/40"}`}>
        <img src={image.storage_url || image.source_url} alt={image.alt || c.suggested_name || "Imagem do produto"} className="h-full w-full object-contain" referrerPolicy="no-referrer" />
        {editable && <input aria-label="Selecionar imagem" type="checkbox" disabled={selectionBusy} checked={image.selected !== false} onChange={(e) => onSelection(c.id, "image", [image.id], e.target.checked)} className="absolute left-2 top-2 h-4 w-4 accent-primary" />}
        {image.is_primary && <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Principal</span>}
        {image.storage_url && <span className="absolute bottom-1 right-1 rounded bg-emerald-700/80 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Nossa</span>}
      </label>)}</div>
    </section> : primary && <img src={primary} alt={c.suggested_name || "Imagem do produto"} className="mt-3 h-40 w-full rounded bg-muted object-contain" referrerPolicy="no-referrer" />}

    <div className="mt-2 text-sm"><div>{c.suggested_name}</div>{c.suggested_description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.suggested_description}</p>}</div>

    {applications.length > 0 && <section className="mt-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2"><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Aplicações veiculares</div>{editable && <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold"><input type="checkbox" disabled={selectionBusy} checked={selectedApplications.length === applications.length && applications.length > 0} onChange={(e) => onSelection(c.id, "application", undefined, e.target.checked)} />Selecionar todas</label>}</div>
      <div className="mt-2 max-h-64 space-y-1 overflow-auto">{applications.map((app) => <label key={app.id} className={`flex items-center gap-2 rounded border px-2 py-2 text-xs ${app.selected === false ? "opacity-50" : "bg-background"}`}>
        {editable && <input aria-label="Selecionar aplicação" type="checkbox" disabled={selectionBusy} checked={app.selected !== false} onChange={(e) => onSelection(c.id, "application", [app.id], e.target.checked)} className="h-4 w-4 shrink-0 accent-primary" />}
        <span className="min-w-0 flex-1 font-medium">{app.vehicle_make} {app.vehicle_model}</span><span className="shrink-0 text-muted-foreground">{formatYears(app.year_from, app.year_to)} · {Number(app.confidence).toFixed(0)}%</span>
      </label>)}</div>
    </section>}

    <div className="mt-3 flex flex-wrap gap-2">
      <a href={c.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded border px-2 py-1 text-xs">Ver fonte</a>
      {editable && needsCopy && <Button size="sm" variant="outline" onClick={() => onCopy(c.id)}><ImageDown className="mr-1 h-3 w-3" />{selectedGallery.length > 1 ? `Copiar selecionadas (${selectedGallery.length})` : "Copiar imagem selecionada"}</Button>}
      {editable && !needsCopy && <Button size="sm" onClick={() => onApprove(c.id)}><Check className="mr-1 h-3 w-3" />Aprovar seleção</Button>}
      {editable && <Button size="sm" variant="outline" onClick={() => onReject(c.id)}><X className="mr-1 h-3 w-3" />Rejeitar</Button>}
    </div>
  </div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="text-xs font-semibold uppercase text-muted-foreground">{label}<Input className="mt-1" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
function Status({ value }: { value: string }) {
  const labels: Record<string,string> = { queued: "Na fila", processing: "Processando", review: "Revisão", approved: "Aprovado", failed: "Falha", pending: "Pendente", rejected: "Rejeitado", cancelled: "Cancelado" };
  return <span className="h-fit rounded-full bg-muted px-2 py-1 text-[10px] font-bold uppercase">{labels[value] || value}</span>;
}
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{children}</span>;
}
function formatYears(from?: number | null, to?: number | null) {
  if (from && to) return from === to ? String(from) : `${from}–${to}`;
  if (from) return `a partir de ${from}`;
  if (to) return `até ${to}`;
  return "ano não informado";
}
