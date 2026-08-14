import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { SupplyStatusBadge } from "@/components/admin/SupplyStatusBadge";
import { listGoodsReceipts } from "@/lib/supplies.functions";
import { formatDate } from "@/lib/supplies-ui";

export const Route = createFileRoute("/_authenticated/admin/recebimentos/")({
  head: () => ({
    meta: [
      { title: "Recebimentos · Admin" },
      { name: "description", content: "Recebimento de mercadorias com atualização de estoque e custo." },
    ],
  }),
  component: RecebimentosPage,
});

const filters = [
  { key: "draft", label: "Em conferência" },
  { key: "confirmed", label: "Confirmados" },
  { key: "reversed", label: "Estornados" },
  { key: "all", label: "Todos" },
] as const;

function RecebimentosPage() {
  const listFn = useServerFn(listGoodsReceipts);
  const [status, setStatus] = useState<(typeof filters)[number]["key"]>("draft");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["goods-receipts", status],
    queryFn: () => listFn({ data: { status } }),
  });

  const term = search.trim().toLowerCase();
  const rows = (data ?? []).filter((receipt: any) =>
    !term
      ? true
      : [receipt.number?.toString(), receipt.invoice_number, receipt.supplier?.legal_name]
          .filter(Boolean)
          .some((value: string) => value.toLowerCase().includes(term)),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase">Recebimentos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conferência de mercadoria: ao confirmar, o estoque do depósito e o custo do produto são atualizados
          em uma única transação.
        </p>
      </header>

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
          className="w-full sm:w-64"
          placeholder="Buscar por número, NF ou fornecedor"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {isError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
          {(error as Error)?.message ?? "Não foi possível carregar os recebimentos."}
        </div>
      )}

      <div className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando recebimentos…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum recebimento neste filtro.</p>
        )}
        {rows.map((receipt: any) => (
          <Link
            key={receipt.id}
            to="/admin/recebimentos/$id"
            params={{ id: receipt.id }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
          >
            <div className="min-w-0">
              <div className="font-display text-lg font-bold">
                #{receipt.number} · {receipt.supplier?.legal_name ?? "Fornecedor"}
              </div>
              <div className="text-xs text-muted-foreground">
                Pedido #{receipt.purchase_order?.number} · {formatDate(receipt.received_at)} ·{" "}
                {receipt.warehouse?.name}
                {receipt.invoice_number ? ` · NF ${receipt.invoice_number}` : ""}
              </div>
            </div>
            <SupplyStatusBadge status={receipt.status} kind="receipt" />
          </Link>
        ))}
      </div>
    </div>
  );
}
