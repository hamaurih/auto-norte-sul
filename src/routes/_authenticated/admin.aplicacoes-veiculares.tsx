import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  generateVehicleApplicationCandidates,
  getVehicleApplicationCenterStats,
  listPublishedVehicleApplications,
  listVehicleApplicationCandidates,
  reviewVehicleApplicationCandidate,
  type VehicleApplicationCandidateSource,
  type VehicleApplicationCandidateStatus,
} from "@/lib/vehicle-applications.functions";

export const Route = createFileRoute("/_authenticated/admin/aplicacoes-veiculares")({
  head: () => ({
    meta: [
      { title: "Aplicações Veiculares · Admin" },
      { name: "description", content: "Central auditável para validar compatibilidade entre peças e veículos." },
    ],
  }),
  component: VehicleApplicationCenter,
});

type Candidate = {
  id: string;
  product_id: string;
  vehicle_make: string;
  vehicle_model: string;
  year_from: number | null;
  year_to: number | null;
  source_type: VehicleApplicationCandidateSource;
  source_name: string | null;
  source_url: string | null;
  evidence_text: string | null;
  match_reason: string | null;
  confidence: number | string;
  status: VehicleApplicationCandidateStatus;
  review_notes: string | null;
  product?: { id: string; name: string; sku: string | null; manufacturer_code: string | null } | null;
};

function Stat({ label, value, attention }: { label: string; value: number; attention?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${attention ? "border-hot bg-hot/5" : "border-border bg-card"}`}>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}

function confidenceLabel(value: number) {
  if (value >= 0.9) return "alta";
  if (value >= 0.75) return "média";
  return "revisar";
}

function sourceLabel(source: string) {
  if (source === "official_enrichment") return "Fonte oficial";
  if (source === "product_name") return "Nome do produto";
  if (source === "manual") return "Manual";
  return "Importação";
}

function VehicleApplicationCenter() {
  const statsFn = useServerFn(getVehicleApplicationCenterStats);
  const generateFn = useServerFn(generateVehicleApplicationCandidates);
  const qc = useQueryClient();

  const stats = useQuery({
    queryKey: ["vehicle-app-stats"],
    queryFn: () => statsFn(),
    refetchInterval: 30_000,
  });

  const generate = useMutation({
    mutationFn: () => generateFn({ data: { limit: 2000 } }),
    onSuccess: (result) => {
      toast.success(result.generated > 0 ? `${result.generated} novos candidatos gerados para revisão.` : "Nenhum novo candidato seguro encontrado neste lote.");
      qc.invalidateQueries({ queryKey: ["vehicle-app-stats"] });
      qc.invalidateQueries({ queryKey: ["vehicle-app-candidates"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Não foi possível gerar candidatos."),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase">Central de Aplicação Veicular</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Compatibilidade só é publicada depois de aprovação. Evidências de fabricante e sugestões extraídas do nome ficam separadas e auditáveis.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link to="/admin/saneamento">Voltar ao saneamento</Link></Button>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? "Analisando catálogo…" : "Gerar candidatos do nome"}
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Produtos ativos" value={stats.data?.activeProducts ?? 0} />
        <Stat label="Com aplicação" value={stats.data?.productsWithApplications ?? 0} />
        <Stat label="Sem aplicação" value={stats.data?.productsWithoutApplications ?? 0} attention={(stats.data?.productsWithoutApplications ?? 0) > 0} />
        <Stat label="Candidatos pendentes" value={stats.data?.pendingCandidates ?? 0} attention={(stats.data?.pendingCandidates ?? 0) > 0} />
        <Stat label="Alta confiança" value={stats.data?.highConfidencePending ?? 0} />
        <Stat label="Fonte oficial" value={stats.data?.officialSourcePending ?? 0} />
        <Stat label="Aplicações publicadas" value={stats.data?.publishedApplications ?? 0} />
        <Stat label="Candidatos aprovados" value={stats.data?.approvedCandidates ?? 0} />
        <Stat label="Candidatos rejeitados" value={stats.data?.rejectedCandidates ?? 0} />
      </section>

      <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        <b className="text-foreground">Regra de segurança:</b> sugestão não significa compatibilidade confirmada. Candidatos vindos apenas do nome do produto nunca são autoaprovados. Em produtos com vários modelos no mesmo nome, a faixa de anos fica em branco para revisão.
      </div>

      <Tabs defaultValue="fila">
        <TabsList>
          <TabsTrigger value="fila">Fila de revisão</TabsTrigger>
          <TabsTrigger value="publicadas">Aplicações publicadas</TabsTrigger>
        </TabsList>
        <TabsContent value="fila" className="mt-4"><CandidateQueue /></TabsContent>
        <TabsContent value="publicadas" className="mt-4"><PublishedApplications /></TabsContent>
      </Tabs>
    </div>
  );
}

function CandidateQueue() {
  const listFn = useServerFn(listVehicleApplicationCandidates);
  const [status, setStatus] = useState<VehicleApplicationCandidateStatus | "all">("pending");
  const [source, setSource] = useState<VehicleApplicationCandidateSource | "all">("all");
  const [minConfidence, setMinConfidence] = useState(0);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const q = useQuery({
    queryKey: ["vehicle-app-candidates", status, source, minConfidence, search, offset],
    queryFn: () => listFn({ data: { status, source, minConfidence, search: search || undefined, limit, offset } }),
  });

  const total = q.data?.count ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-3">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} placeholder="Buscar veículo ou evidência…" className="w-full max-w-xs" />
        <select value={status} onChange={(e) => { setStatus(e.target.value as any); setOffset(0); }} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="pending">Pendentes</option><option value="approved">Aprovados</option><option value="rejected">Rejeitados</option><option value="all">Todos</option>
        </select>
        <select value={source} onChange={(e) => { setSource(e.target.value as any); setOffset(0); }} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="all">Todas as fontes</option><option value="official_enrichment">Fonte oficial</option><option value="product_name">Nome do produto</option><option value="manual">Manual</option><option value="import">Importação</option>
        </select>
        <select value={String(minConfidence)} onChange={(e) => { setMinConfidence(Number(e.target.value)); setOffset(0); }} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="0">Toda confiança</option><option value="0.9">≥ 90%</option><option value="0.75">≥ 75%</option><option value="0.6">≥ 60%</option>
        </select>
        <span className="self-center text-xs text-muted-foreground">{total.toLocaleString("pt-BR")} registros</span>
      </div>

      {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando candidatos…</p> : (
        <div className="space-y-2">
          {(q.data?.rows ?? []).map((row: any) => <CandidateCard key={row.id} candidate={row as Candidate} />)}
          {(q.data?.rows ?? []).length === 0 && <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">Nenhum candidato neste filtro.</div>}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Anterior</Button>
        <span className="text-xs text-muted-foreground">{total ? `${offset + 1}–${Math.min(offset + limit, total)} de ${total}` : "0 registros"}</span>
        <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Próxima</Button>
      </div>
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: Candidate }) {
  const reviewFn = useServerFn(reviewVehicleApplicationCandidate);
  const qc = useQueryClient();
  const [make, setMake] = useState(candidate.vehicle_make ?? "");
  const [model, setModel] = useState(candidate.vehicle_model ?? "");
  const [yearFrom, setYearFrom] = useState(candidate.year_from?.toString() ?? "");
  const [yearTo, setYearTo] = useState(candidate.year_to?.toString() ?? "");
  const [notes, setNotes] = useState(candidate.review_notes ?? "");
  const confidence = Number(candidate.confidence ?? 0);

  const review = useMutation({
    mutationFn: (decision: "approve" | "reject") => reviewFn({ data: {
      candidateId: candidate.id,
      decision,
      vehicleMake: make.trim(),
      vehicleModel: model.trim(),
      yearFrom: yearFrom ? Number(yearFrom) : null,
      yearTo: yearTo ? Number(yearTo) : null,
      reviewNotes: notes.trim() || null,
    } }),
    onSuccess: (_result, decision) => {
      toast.success(decision === "approve" ? "Aplicação aprovada e publicada." : "Candidato rejeitado.");
      qc.invalidateQueries({ queryKey: ["vehicle-app-stats"] });
      qc.invalidateQueries({ queryKey: ["vehicle-app-candidates"] });
      qc.invalidateQueries({ queryKey: ["vehicle-app-published"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Não foi possível revisar o candidato."),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/admin/produtos/$id" params={{ id: candidate.product_id }} className="font-semibold hover:underline">{candidate.product?.name ?? "Produto"}</Link>
            <span className="font-mono text-[11px] text-muted-foreground">{candidate.product?.sku ?? "sem SKU"}</span>
            <Badge variant="outline">{sourceLabel(candidate.source_type)}</Badge>
            <Badge variant="outline">{Math.round(confidence * 100)}% · {confidenceLabel(confidence)}</Badge>
            <Badge variant="outline">{candidate.status}</Badge>
          </div>
          {candidate.match_reason && <p className="mt-1 text-xs text-muted-foreground">{candidate.match_reason}</p>}
        </div>
        {candidate.source_url?.startsWith("https://") && <a href={candidate.source_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">Abrir evidência oficial</a>}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_100px_100px]">
        <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Montadora" disabled={candidate.status !== "pending"} />
        <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Modelo" disabled={candidate.status !== "pending"} />
        <Input value={yearFrom} onChange={(e) => setYearFrom(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Ano inicial" inputMode="numeric" disabled={candidate.status !== "pending"} />
        <Input value={yearTo} onChange={(e) => setYearTo(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Ano final" inputMode="numeric" disabled={candidate.status !== "pending"} />
      </div>
      <Input className="mt-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observação da revisão (opcional)" disabled={candidate.status !== "pending"} />

      {candidate.evidence_text && (
        <div className="mt-3 rounded-md bg-muted/60 p-2 text-xs">
          <span className="font-semibold">Evidência:</span> {candidate.evidence_text}
        </div>
      )}

      {candidate.status === "pending" && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={review.isPending} onClick={() => review.mutate("reject")}>Rejeitar</Button>
          <Button size="sm" disabled={review.isPending || !make.trim() || !model.trim()} onClick={() => review.mutate("approve")}>{review.isPending ? "Salvando…" : "Aprovar e publicar"}</Button>
        </div>
      )}
    </div>
  );
}

function PublishedApplications() {
  const fn = useServerFn(listPublishedVehicleApplications);
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const q = useQuery({
    queryKey: ["vehicle-app-published", offset],
    queryFn: () => fn({ data: { limit, offset } }),
  });
  const total = q.data?.count ?? 0;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted"><tr><th className="p-2 text-left">Produto</th><th className="p-2 text-left">Aplicação</th><th className="p-2 text-left">Período</th><th className="p-2 text-left">Fonte</th><th className="p-2 text-left">Confiança</th></tr></thead>
          <tbody>
            {(q.data?.rows ?? []).map((row: any) => (
              <tr key={row.id} className="border-t border-border">
                <td className="p-2"><Link to="/admin/produtos/$id" params={{ id: row.product_id }} className="hover:underline">{row.product?.name ?? "Produto"}</Link><div className="font-mono text-[10px] text-muted-foreground">{row.product?.sku ?? "—"}</div></td>
                <td className="p-2 font-medium">{row.vehicle_make} {row.vehicle_model}</td>
                <td className="p-2">{row.year_from || row.year_to ? `${row.year_from ?? "…"}–${row.year_to ?? "…"}` : "Não informado"}</td>
                <td className="p-2">{sourceLabel(row.source_type ?? "manual")}</td>
                <td className="p-2">{row.confidence == null ? "—" : `${Math.round(Number(row.confidence) * 100)}%`}</td>
              </tr>
            ))}
            {(q.data?.rows ?? []).length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Nenhuma aplicação publicada ainda.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Anterior</Button>
        <span className="text-xs text-muted-foreground">{total.toLocaleString("pt-BR")} aplicações</span>
        <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Próxima</Button>
      </div>
    </div>
  );
}
