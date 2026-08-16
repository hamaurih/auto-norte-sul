import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  MapPin,
  PackageCheck,
  Printer,
  Search,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { brl } from "@/lib/format";
import {
  addShipmentOccurrence,
  listShippingQueue,
  saveShipment,
  type ShipmentInput,
  type ShipmentStatus,
} from "@/lib/shipping.functions";

export const Route = createFileRoute("/_authenticated/admin/expedicao")({
  head: () => ({ meta: [{ title: "Central de Expedição · Admin" }] }),
  component: ShippingCenterPage,
});

const statusLabels: Record<string, string> = {
  aguardando_separacao: "Aguardando separação",
  em_separacao: "Em separação",
  aguardando_conferencia: "Aguardando conferência",
  pronto_envio: "Pronto para envio",
  postado: "Postado",
  em_transito: "Em trânsito",
  entregue: "Entregue",
  ocorrencia: "Com ocorrência",
  devolvido: "Devolvido",
  cancelado: "Cancelado",
};

const statusTone: Record<string, string> = {
  aguardando_separacao: "bg-amber-100 text-amber-800",
  em_separacao: "bg-blue-100 text-blue-800",
  aguardando_conferencia: "bg-violet-100 text-violet-800",
  pronto_envio: "bg-cyan-100 text-cyan-800",
  postado: "bg-indigo-100 text-indigo-800",
  em_transito: "bg-fuchsia-100 text-fuchsia-800",
  entregue: "bg-emerald-100 text-emerald-800",
  ocorrencia: "bg-rose-100 text-rose-800",
  devolvido: "bg-orange-100 text-orange-800",
  cancelado: "bg-slate-100 text-slate-700",
};

const statusOptions = Object.keys(statusLabels) as ShipmentStatus[];

function ShippingCenterPage() {
  const listFn = useServerFn(listShippingQueue);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("todos");
  const [selected, setSelected] = useState<any | null>(null);

  const queue = useQuery({
    queryKey: ["shipping-queue"],
    queryFn: () => listFn(),
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (queue.data ?? []).filter((row: any) => {
      const shipmentStatus = row.shipment?.status ?? "aguardando_separacao";
      const matchesStatus = status === "todos" || shipmentStatus === status;
      const matchesTerm =
        !term ||
        row.order.id.toLowerCase().includes(term) ||
        (row.order.customer_name ?? "").toLowerCase().includes(term) ||
        (row.shipment?.tracking_code ?? "").toLowerCase().includes(term);
      return matchesStatus && matchesTerm;
    });
  }, [queue.data, search, status]);

  const metrics = useMemo(() => {
    const all = queue.data ?? [];
    return {
      pending: all.filter((row: any) => !row.shipment || row.shipment.status === "aguardando_separacao").length,
      ready: all.filter((row: any) => row.shipment?.status === "pronto_envio").length,
      transit: all.filter((row: any) => ["postado", "em_transito"].includes(row.shipment?.status)).length,
      incidents: all.filter((row: any) => row.shipment?.status === "ocorrencia").length,
    };
  }, [queue.data]);

  async function refresh() {
    setSelected(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shipping-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] }),
    ]);
  }

  if (queue.isLoading) return <div className="rounded-3xl border border-dashed p-12 text-center text-muted-foreground">Carregando expedição…</div>;
  if (queue.isError) return <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-rose-800">{(queue.error as Error).message}</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="admin-page-hero">
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-cyan-100 px-3 py-1 text-xs font-extrabold text-cyan-800">
              <Truck className="h-4 w-4" aria-hidden="true" /> OPERAÇÃO LOGÍSTICA
            </span>
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Central de Expedição</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Separe, confira, despache e acompanhe pedidos sem depender do Bling.
            </p>
          </div>
          <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border bg-white px-4 text-sm font-extrabold shadow-sm hover:bg-muted">
            <Printer className="h-4 w-4" aria-hidden="true" /> Imprimir fila
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Box} label="Aguardando separação" value={metrics.pending} tone="bg-amber-100 text-amber-700" />
        <Metric icon={ClipboardCheck} label="Prontos para envio" value={metrics.ready} tone="bg-cyan-100 text-cyan-700" />
        <Metric icon={Truck} label="Em transporte" value={metrics.transit} tone="bg-violet-100 text-violet-700" />
        <Metric icon={AlertTriangle} label="Com ocorrência" value={metrics.incidents} tone="bg-rose-100 text-rose-700" />
      </section>

      <section className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm print:hidden">
        <div className="grid gap-3 md:grid-cols-[1fr_240px]">
          <label className="relative">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pedido, cliente ou rastreamento" className="w-full pl-10" />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full">
            <option value="todos">Todos os status</option>
            {statusOptions.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
          </select>
        </div>
      </section>

      {rows.length === 0 ? (
        <section className="rounded-3xl border border-dashed p-12 text-center text-muted-foreground">Nenhum pedido encontrado nesta fila.</section>
      ) : (
        <section className="grid gap-4">
          {rows.map((row: any) => {
            const shipmentStatus = row.shipment?.status ?? "aguardando_separacao";
            const pkg = row.shipment?.packages?.[0];
            return (
              <article key={row.order.id} className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
                <div className="grid gap-5 lg:grid-cols-[1fr_1fr_auto] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${statusTone[shipmentStatus]}`}>{statusLabels[shipmentStatus]}</span>
                      <span className="font-mono text-xs text-muted-foreground">#{row.order.id.slice(0, 8)}</span>
                    </div>
                    <h2 className="mt-2 font-display text-lg font-extrabold">{row.order.customer_name || "Cliente não informado"}</h2>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> {row.order.shipping_city || "Cidade não informada"}{row.order.shipping_state ? `/${row.order.shipping_state}` : ""}</p>
                  </div>
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <Info label="Transportadora" value={row.shipment?.carrier_name || "Não definida"} />
                    <Info label="Serviço" value={row.shipment?.service_name || "Não definido"} />
                    <Info label="Rastreamento" value={row.shipment?.tracking_code || "Não informado"} />
                    <Info label="Volume" value={pkg ? `${pkg.weight_kg} kg · ${pkg.length_cm}×${pkg.width_cm}×${pkg.height_cm} cm` : "Não medido"} />
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end print:hidden">
                    {row.shipment?.tracking_code && (
                      <button type="button" onClick={() => navigator.clipboard.writeText(row.shipment.tracking_code)} className="grid size-11 place-items-center rounded-2xl border hover:bg-muted" title="Copiar rastreio"><Copy className="h-4 w-4" /></button>
                    )}
                    {row.shipment?.tracking_url && (
                      <a href={row.shipment.tracking_url} target="_blank" rel="noreferrer" className="grid size-11 place-items-center rounded-2xl border hover:bg-muted" title="Abrir rastreio"><ExternalLink className="h-4 w-4" /></a>
                    )}
                    <Link to="/admin/pedidos/$id" params={{ id: row.order.id }} className="inline-flex min-h-11 items-center rounded-2xl border px-3 text-xs font-bold hover:bg-muted">Ver pedido</Link>
                    <button type="button" onClick={() => setSelected(row)} className="inline-flex min-h-11 items-center rounded-2xl bg-violet-600 px-4 text-xs font-extrabold text-white hover:bg-violet-700">Operar</button>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span>Pedido de {new Date(row.order.created_at).toLocaleDateString("pt-BR")}</span>
                  <strong className="text-foreground">{brl(Number(row.order.total))}</strong>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {selected && <ShipmentEditor row={selected} onClose={() => setSelected(null)} onSaved={refresh} />}
    </div>
  );
}

function ShipmentEditor({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => Promise<void> }) {
  const saveFn = useServerFn(saveShipment);
  const occurrenceFn = useServerFn(addShipmentOccurrence);
  const shipment = row.shipment;
  const pkg = shipment?.packages?.[0];
  const [form, setForm] = useState<ShipmentInput>({
    orderId: row.order.id,
    status: shipment?.status ?? "aguardando_separacao",
    carrierName: shipment?.carrier_name ?? "",
    serviceName: shipment?.service_name ?? "",
    trackingCode: shipment?.tracking_code ?? "",
    trackingUrl: shipment?.tracking_url ?? "",
    estimatedDeliveryAt: shipment?.estimated_delivery_at ?? "",
    notes: shipment?.notes ?? "",
    package: {
      weightKg: Number(pkg?.weight_kg ?? 1),
      heightCm: Number(pkg?.height_cm ?? 10),
      widthCm: Number(pkg?.width_cm ?? 10),
      lengthCm: Number(pkg?.length_cm ?? 10),
    },
  });
  const [occurrence, setOccurrence] = useState("");
  const [occurrenceType, setOccurrenceType] = useState<"ocorrencia" | "atraso" | "avaria" | "extravio" | "devolucao" | "observacao">("observacao");

  const save = useMutation({
    mutationFn: () => saveFn({ data: form }),
    onSuccess: onSaved,
  });
  const addOccurrence = useMutation({
    mutationFn: () => occurrenceFn({ data: { shipmentId: shipment.id, type: occurrenceType, description: occurrence } }),
    onSuccess: onSaved,
  });

  function field(name: keyof ShipmentInput, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }
  function packageField(name: "weightKg" | "heightCm" | "widthCm" | "lengthCm", value: string) {
    setForm((current) => ({ ...current, package: { ...current.package!, [name]: Number(value) } }));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-slate-950/45 p-0 backdrop-blur-sm sm:place-items-center sm:p-4 print:hidden" role="dialog" aria-modal="true">
      <div className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-background p-5 shadow-2xl sm:rounded-3xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-extrabold text-violet-700">EXPEDIÇÃO</p><h2 className="font-display text-2xl font-extrabold">Pedido #{row.order.id.slice(0, 8)}</h2></div>
          <button type="button" onClick={onClose} className="rounded-xl border px-3 py-2 text-sm font-bold">Fechar</button>
        </div>

        {(save.isError || addOccurrence.isError) && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{((save.error || addOccurrence.error) as Error).message}</p>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Status"><select value={form.status} onChange={(e) => field("status", e.target.value)}>{statusOptions.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></Field>
          <Field label="Previsão de entrega"><input type="date" value={form.estimatedDeliveryAt} onChange={(e) => field("estimatedDeliveryAt", e.target.value)} /></Field>
          <Field label="Transportadora"><input value={form.carrierName} onChange={(e) => field("carrierName", e.target.value)} placeholder="Ex.: Correios" /></Field>
          <Field label="Modalidade"><input value={form.serviceName} onChange={(e) => field("serviceName", e.target.value)} placeholder="Ex.: PAC" /></Field>
          <Field label="Código de rastreamento"><input value={form.trackingCode} onChange={(e) => field("trackingCode", e.target.value)} /></Field>
          <Field label="Link de rastreamento"><input type="url" value={form.trackingUrl} onChange={(e) => field("trackingUrl", e.target.value)} placeholder="https://…" /></Field>
        </div>

        <h3 className="mt-6 font-display text-lg font-extrabold">Volume principal</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Peso (kg)"><input type="number" min="0.001" step="0.001" value={form.package?.weightKg} onChange={(e) => packageField("weightKg", e.target.value)} /></Field>
          <Field label="Altura (cm)"><input type="number" min="0.1" step="0.1" value={form.package?.heightCm} onChange={(e) => packageField("heightCm", e.target.value)} /></Field>
          <Field label="Largura (cm)"><input type="number" min="0.1" step="0.1" value={form.package?.widthCm} onChange={(e) => packageField("widthCm", e.target.value)} /></Field>
          <Field label="Comprimento (cm)"><input type="number" min="0.1" step="0.1" value={form.package?.lengthCm} onChange={(e) => packageField("lengthCm", e.target.value)} /></Field>
        </div>
        <Field label="Observações"><textarea rows={3} maxLength={1000} value={form.notes} onChange={(e) => field("notes", e.target.value)} /></Field>

        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-60">
          <PackageCheck className="h-4 w-4" /> {save.isPending ? "Salvando…" : "Salvar expedição"}
        </button>

        {shipment && (
          <section className="mt-7 border-t pt-6">
            <h3 className="font-display text-lg font-extrabold">Registrar ocorrência</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-[190px_1fr]">
              <select value={occurrenceType} onChange={(e) => setOccurrenceType(e.target.value as typeof occurrenceType)}>
                <option value="observacao">Observação</option><option value="atraso">Atraso</option><option value="avaria">Avaria</option><option value="extravio">Extravio</option><option value="devolucao">Devolução</option><option value="ocorrencia">Outra ocorrência</option>
              </select>
              <input value={occurrence} onChange={(e) => setOccurrence(e.target.value)} maxLength={1000} placeholder="Descreva o ocorrido" />
            </div>
            <button type="button" disabled={!occurrence.trim() || addOccurrence.isPending} onClick={() => addOccurrence.mutate()} className="mt-3 min-h-11 rounded-2xl border border-rose-200 px-4 text-sm font-extrabold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Registrar no histórico</button>
          </section>
        )}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Truck; label: string; value: number; tone: string }) {
  return <article className="rounded-3xl border bg-card p-4 shadow-sm"><span className={`grid size-10 place-items-center rounded-2xl ${tone}`}><Icon className="h-5 w-5" /></span><p className="mt-3 text-xs font-bold text-muted-foreground">{label}</p><p className="font-display text-3xl font-extrabold">{value}</p></article>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 truncate font-semibold">{value}</p></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mt-3 block"><span className="mb-1.5 block text-xs font-bold text-muted-foreground">{label}</span><div className="[&>*]:w-full">{children}</div></label>;
}