import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveRestore,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileJson,
  FileSpreadsheet,
  History,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  generateOperationalExport,
  getBackupExportCenter,
  requestBackupRestore,
  type ExportFormat,
  type ExportType,
} from "@/lib/backup-export.functions";

export const Route = createFileRoute("/_authenticated/admin/backup-exportacao")({
  head: () => ({ meta: [{ title: "Backup e exportação · Norte Sul" }] }),
  component: BackupExportCenter,
});

const modules: Array<{ value: ExportType; label: string; description: string }> = [
  {
    value: "products",
    label: "Produtos",
    description: "Cadastro, códigos, preços, custos e saldo consolidado",
  },
  { value: "customers", label: "Clientes", description: "Cadastro e contatos comerciais" },
  {
    value: "stock",
    label: "Estoque por depósito",
    description: "Saldo físico, reservado e mínimo por depósito",
  },
  { value: "sales", label: "Vendas", description: "Pedidos e valores por período" },
  {
    value: "financial",
    label: "Financeiro",
    description: "Movimentações e conciliação por período",
  },
  { value: "fiscal", label: "Fiscal", description: "Documentos fiscais e situação de transmissão" },
];

const labels: Record<ExportType, string> = Object.fromEntries(
  modules.map((item) => [item.value, item.label]),
) as Record<ExportType, string>;

type ExportJob = {
  id: string;
  export_type: ExportType;
  file_format: ExportFormat;
  status: "processing" | "completed" | "failed";
  row_count: number;
  byte_size: number;
  created_at: string;
};

function download(content: string, fileName: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function BackupExportCenter() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["backup-export-center"],
    queryFn: () => getBackupExportCenter(),
  });
  const [type, setType] = useState<ExportType>("products");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState("");
  const [reason, setReason] = useState("");

  const generate = useMutation({
    mutationFn: () =>
      generateOperationalExport({
        data: { type, format, startDate: startDate || undefined, endDate: endDate || undefined },
      }),
    onSuccess: async (result) => {
      download(result.content, result.fileName, result.mimeType);
      toast.success(`${result.rowCount.toLocaleString("pt-BR")} registros exportados.`);
      await queryClient.invalidateQueries({ queryKey: ["backup-export-center"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const restore = useMutation({
    mutationFn: () => requestBackupRestore({ data: { reason, snapshotAt } }),
    onSuccess: async () => {
      toast.success("Solicitação registrada para revisão segura.");
      setRestoreOpen(false);
      setReason("");
      setSnapshotAt("");
      await queryClient.invalidateQueries({ queryKey: ["backup-export-center"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const transactional = type === "sales" || type === "financial" || type === "fiscal";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="admin-page-hero overflow-hidden rounded-3xl border border-blue-200 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-900 p-6 text-white shadow-xl md:p-8">
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-cyan-100">
              <ShieldCheck className="h-4 w-4" /> Dados protegidos
            </div>
            <h1 className="font-display text-3xl font-black uppercase md:text-4xl">
              Backup e exportação
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-blue-100 md:text-base">
              Extraia os dados operacionais da empresa com histórico auditável. Backups completos do
              banco permanecem protegidos na infraestrutura.
            </p>
          </div>
          <DatabaseBackup className="h-20 w-20 text-cyan-300/80" aria-hidden="true" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
        <section className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-blue-100 text-blue-700">
              <Download className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold">Nova exportação</h2>
              <p className="text-sm text-muted-foreground">
                Selecione o conjunto de dados e baixe imediatamente.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {modules.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setType(item.value)}
                className={`rounded-xl border p-4 text-left transition ${type === item.value ? "border-blue-500 bg-blue-50 ring-2 ring-blue-500/10" : "hover:border-blue-200 hover:bg-muted/40"}`}
              >
                <span className="block font-semibold">{item.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-sm font-semibold">Formato</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormat("csv")}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold ${format === "csv" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "bg-background"}`}
                >
                  <FileSpreadsheet className="h-4 w-4" /> CSV
                </button>
                <button
                  type="button"
                  onClick={() => setFormat("json")}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold ${format === "json" ? "border-violet-500 bg-violet-50 text-violet-800" : "bg-background"}`}
                >
                  <FileJson className="h-4 w-4" /> JSON
                </button>
              </div>
            </label>
            <div className={transactional ? "grid grid-cols-2 gap-2" : "opacity-45"}>
              <label>
                <span className="mb-1.5 block text-sm font-semibold">De</span>
                <input
                  type="date"
                  disabled={!transactional}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="min-h-11 w-full rounded-xl border bg-background px-3 text-sm"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-sm font-semibold">Até</span>
                <input
                  type="date"
                  disabled={!transactional}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="min-h-11 w-full rounded-xl border bg-background px-3 text-sm"
                />
              </label>
            </div>
          </div>
          <button
            type="button"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
            className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 font-bold text-white shadow-lg shadow-blue-700/20 transition hover:bg-blue-800 disabled:opacity-50"
          >
            <Download className="h-5 w-5" />
            {generate.isPending ? "Preparando arquivo…" : `Exportar ${labels[type]}`}
          </button>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm md:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-amber-800">
              <ArchiveRestore className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold">Restauração protegida</h2>
              <p className="text-sm text-muted-foreground">
                Operação crítica com revisão administrativa.
              </p>
            </div>
          </div>
          <p className="mt-5 text-sm leading-6 text-slate-700">
            A restauração nunca é executada diretamente por esta tela. A solicitação fica registrada
            e precisa ser analisada por outro administrador, evitando perda acidental de dados.
          </p>
          {!restoreOpen ? (
            <button
              type="button"
              onClick={() => setRestoreOpen(true)}
              className="mt-5 min-h-11 w-full rounded-xl border border-amber-400 bg-white px-4 text-sm font-bold text-amber-900 hover:bg-amber-100"
            >
              Solicitar restauração
            </button>
          ) : (
            <div className="mt-5 space-y-3 rounded-xl border border-amber-200 bg-white p-4">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">Data e hora desejada</span>
                <input
                  type="datetime-local"
                  value={snapshotAt}
                  onChange={(e) => setSnapshotAt(e.target.value)}
                  className="min-h-11 w-full rounded-lg border px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">Motivo detalhado</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border p-3 text-sm"
                  placeholder="Descreva o problema e por que a restauração é necessária."
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRestoreOpen(false)}
                  className="min-h-10 flex-1 rounded-lg border text-sm font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={restore.isPending || reason.trim().length < 10 || !snapshotAt}
                  onClick={() => restore.mutate()}
                  className="min-h-10 flex-1 rounded-lg bg-amber-700 text-sm font-bold text-white disabled:opacity-50"
                >
                  Registrar
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b p-5">
          <History className="h-5 w-5 text-blue-700" />
          <div>
            <h2 className="font-display text-xl font-bold">Histórico de exportações</h2>
            <p className="text-sm text-muted-foreground">
              Registro de arquivos gerados neste ambiente.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Carregando histórico…</p>
          ) : !data?.jobs.length ? (
            <p className="p-6 text-sm text-muted-foreground">Nenhuma exportação realizada.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-5 py-3 text-left">Módulo</th>
                  <th className="px-5 py-3 text-left">Formato</th>
                  <th className="px-5 py-3 text-left">Registros</th>
                  <th className="px-5 py-3 text-left">Tamanho</th>
                  <th className="px-5 py-3 text-left">Situação</th>
                  <th className="px-5 py-3 text-left">Data</th>
                </tr>
              </thead>
              <tbody>
                {(data.jobs as ExportJob[]).map((job) => (
                  <tr key={job.id}>
                    <td className="px-5 py-3 font-semibold">
                      {labels[job.export_type as ExportType] ?? job.export_type}
                    </td>
                    <td className="px-5 py-3 uppercase">{job.file_format}</td>
                    <td className="px-5 py-3">{Number(job.row_count).toLocaleString("pt-BR")}</td>
                    <td className="px-5 py-3">{formatBytes(Number(job.byte_size))}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${job.status === "completed" ? "bg-emerald-100 text-emerald-800" : job.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
                      >
                        {job.status === "completed" ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : job.status === "failed" ? (
                          <XCircle className="h-3.5 w-3.5" />
                        ) : null}
                        {job.status === "completed"
                          ? "Concluída"
                          : job.status === "failed"
                            ? "Falhou"
                            : "Processando"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {new Date(job.created_at).toLocaleString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
