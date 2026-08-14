import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { importNfeXml, listNfeImports } from "@/lib/nfe.functions";
import { formatAccessKey, nfeStatusClass, nfeStatusLabel } from "@/lib/nfe-ui";
import { formatDate } from "@/lib/supplies-ui";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/nfe-importacao/")({
  head: () => ({
    meta: [
      { title: "Importar XML de NF-e · Admin" },
      {
        name: "description",
        content: "Importação e conferência de XML de NF-e de compra com atualização de estoque e custo.",
      },
    ],
  }),
  component: GuardedNfeImportPage,
});

const filters = [
  { key: "em_conferencia", label: "Em conferência" },
  { key: "divergente", label: "Divergentes" },
  { key: "pronto", label: "Prontos" },
  { key: "confirmado", label: "Confirmados" },
  { key: "all", label: "Todos" },
] as const;

const MAX_MB = 5;

function NfeImportPage() {
  const listFn = useServerFn(listNfeImports);
  const importFn = useServerFn(importNfeXml);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<(typeof filters)[number]["key"]>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["nfe-imports", status],
    queryFn: () => listFn({ data: { status: status as never } }),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Arquivo acima de ${MAX_MB} MB.`);
      const xml = await file.text();
      return importFn({ data: { xml, fileName: file.name } });
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["nfe-imports"] });
      if (result.duplicated) {
        toast.info("Esta NF-e já havia sido importada; abrindo a conferência existente.");
      } else if (!result.supplierFound) {
        toast.warning("NF-e importada. Fornecedor não cadastrado — confirme o cadastro assistido.");
      } else {
        toast.success("NF-e importada. Confira os itens antes de gerar o recebimento.");
      }
      navigate({ to: "/admin/nfe-importacao/$id", params: { id: result.id } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = (data ?? []).filter((row: any) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [row.access_key, row.nfe_number?.toString(), row.emitter_name, row.file_name]
      .filter(Boolean)
      .some((value: string) => value.toLowerCase().includes(term));
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase">Importação de XML de NF-e</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Importe o XML da nota de compra, confira os itens contra o pedido e gere o recebimento. O estoque e o
          custo só mudam ao confirmar o recebimento.
        </p>
      </header>

      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center">
        <FileUp className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm font-semibold">Selecione o arquivo XML da NF-e (modelo 55, versão 4.x)</p>
        <p className="text-xs text-muted-foreground">Limite de {MAX_MB} MB. Notas repetidas são detectadas pela chave de acesso.</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
        <Button className="mt-3" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {upload.isPending ? "Validando XML…" : "Escolher XML"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setStatus(filter.key)}
            className={`min-h-9 rounded-md border px-3 text-xs font-semibold uppercase transition-colors ${
              status === filter.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
            }`}
          >
            {filter.label}
          </button>
        ))}
        <Input
          className="w-full sm:w-72"
          placeholder="Buscar por chave, número, emitente ou arquivo"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {isError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
          {(error as Error)?.message ?? "Não foi possível carregar as importações."}
        </div>
      )}

      <div className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando importações…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma NF-e importada neste filtro.</p>
        )}
        {rows.map((row: any) => (
          <Link
            key={row.id}
            to="/admin/nfe-importacao/$id"
            params={{ id: row.id }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <div className="min-w-0">
              <div className="font-display text-lg font-bold">
                NF-e {row.nfe_number ?? "—"}/{row.nfe_series ?? "—"} · {row.emitter_name ?? "Emitente"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {formatAccessKey(row.access_key)} · {formatDate(row.issued_at)} · {row.items_count} itens ·{" "}
                {brl(Number(row.total_invoice ?? 0))}
              </div>
            </div>
            <span
              className={`rounded-md px-2 py-1 text-xs font-semibold uppercase ${
                nfeStatusClass[row.status] ?? "bg-muted text-muted-foreground"
              }`}
            >
              {nfeStatusLabel[row.status] ?? row.status}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function GuardedNfeImportPage() {
  return (
    <SupplyGuard>
      <NfeImportPage />
    </SupplyGuard>
  );
}
