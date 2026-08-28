import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, Boxes, Building2, Clock3, PackageCheck, ShieldAlert } from "lucide-react";
import { listBranches, listInventoryProducts, listMovements, stockOverview } from "@/lib/inventory.functions";
import { listInventoryQuarantine, listInventoryReturns, recordInventoryReturn } from "@/lib/returns.functions";

export const Route = createFileRoute("/_authenticated/admin/estoque")({
  head: () => ({ meta: [{ title: "Estoque · Admin" }] }),
  component: EstoquePage,
});

const branchToneStyles = [
  "from-blue-500/12 via-background to-cyan-400/8 border-blue-200/70",
  "from-violet-500/12 via-background to-fuchsia-400/8 border-violet-200/70",
  "from-emerald-500/12 via-background to-lime-400/8 border-emerald-200/70",
];

function EstoquePage() {
  const ovFn = useServerFn(stockOverview);
  const mvFn = useServerFn(listMovements);
  const overview = useQuery({ queryKey: ["stock-overview"], queryFn: () => ovFn() });
  const movs = useQuery({ queryKey: ["stock-movements"], queryFn: () => mvFn({ data: { limit: 50 } }) });
  const queryClient = useQueryClient();
  const branchesFn = useServerFn(listBranches);
  const productsFn = useServerFn(listInventoryProducts);
  const returnsFn = useServerFn(listInventoryReturns);
  const quarantineFn = useServerFn(listInventoryQuarantine);
  const recordReturnFn = useServerFn(recordInventoryReturn);
  const branches = useQuery({ queryKey: ["inventory-branches"], queryFn: () => branchesFn() });
  const products = useQuery({ queryKey: ["inventory-products"], queryFn: () => productsFn() });
  const returns = useQuery({ queryKey: ["inventory-returns"], queryFn: () => returnsFn() });
  const quarantine = useQuery({ queryKey: ["inventory-quarantine"], queryFn: () => quarantineFn() });
  const [returnForm, setReturnForm] = useState({
    return_type: "customer_return" as "customer_return" | "exchange" | "supplier_return" | "defective",
    warehouse_id: "",
    order_id: "",
    returned_product_id: "",
    returned_qty: "1",
    condition: "resalable" as "resalable" | "defective" | "quarantine",
    resolution: "restock" as "restock" | "replace" | "quarantine" | "supplier_return" | "discard",
    replacement_product_id: "",
    replacement_qty: "0",
    reason: "",
    notes: "",
  });
  const warehouseOptions = (branches.data ?? []).flatMap((branch: any) =>
    (branch.warehouses ?? []).map((warehouse: any) => ({
      ...warehouse,
      branch_name: branch.name,
    })),
  );
  const returnMutation = useMutation({
    mutationFn: () => {
      const returnedQty = Number(returnForm.returned_qty);
      const replacementQty = Number(returnForm.replacement_qty);
      if (!returnForm.warehouse_id || !returnForm.returned_product_id) {
        throw new Error("Selecione o depósito e o produto devolvido.");
      }
      if (!Number.isInteger(returnedQty) || returnedQty <= 0) {
        throw new Error("A quantidade devolvida deve ser um inteiro maior que zero.");
      }
      if (returnForm.return_type === "exchange" && (!returnForm.replacement_product_id || replacementQty <= 0)) {
        throw new Error("Uma troca exige produto e quantidade substitutos.");
      }
      return recordReturnFn({
        data: {
          return_type: returnForm.return_type,
          warehouse_id: returnForm.warehouse_id,
          order_id: returnForm.order_id.trim() || null,
          reason: returnForm.reason,
          notes: returnForm.notes,
          items: [{
            returned_product_id: returnForm.returned_product_id,
            returned_qty: returnedQty,
            condition: returnForm.condition,
            resolution: returnForm.resolution,
            replacement_product_id: returnForm.replacement_product_id || null,
            replacement_qty: Number.isInteger(replacementQty) && replacementQty > 0 ? replacementQty : 0,
          }],
        },
      });
    },
    onSuccess: () => {
      toast.success("Devolução/troca registrada e estoque atualizado.");
      setReturnForm((current) => ({
        ...current,
        order_id: "",
        returned_product_id: "",
        returned_qty: "1",
        replacement_product_id: "",
        replacement_qty: "0",
        reason: "",
        notes: "",
      }));
      void queryClient.invalidateQueries({ queryKey: ["inventory-returns"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-quarantine"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível registrar a operação."),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="admin-page-hero">
        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-600/10 px-3 py-1 text-xs font-extrabold text-blue-700">
              <Boxes className="h-3.5 w-3.5" />
              Controle por unidade
            </span>
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Estoque por filial
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Visão rápida das quantidades disponíveis, reservas e movimentações recentes.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-blue-200/70 bg-white/75 px-4 py-3 text-sm text-blue-800 shadow-sm backdrop-blur">
            <PackageCheck className="h-5 w-5" />
            <span className="font-bold">{overview.data?.length ?? 0} unidades monitoradas</span>
          </div>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(overview.data ?? []).map((r, index) => (
          <article
            key={r.branch.id}
            className={`group rounded-3xl border bg-gradient-to-br p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${branchToneStyles[index % branchToneStyles.length]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/80 text-blue-700 shadow-sm">
                <Building2 className="h-5 w-5" />
              </div>
              {r.branch.is_main && (
                <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-white">
                  MATRIZ
                </span>
              )}
            </div>
            <h2 className="mt-4 font-display text-lg font-extrabold">{r.branch.name}</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-white/70 p-3 text-center">
                <div className="text-[10px] font-bold text-muted-foreground">SKUs</div>
                <div className="mt-1 text-xl font-extrabold">{r.skus}</div>
              </div>
              <div className="rounded-2xl bg-white/70 p-3 text-center">
                <div className="text-[10px] font-bold text-muted-foreground">Em mãos</div>
                <div className="mt-1 text-xl font-extrabold text-emerald-700">{r.total_on_hand}</div>
              </div>
              <div className="rounded-2xl bg-white/70 p-3 text-center">
                <div className="text-[10px] font-bold text-muted-foreground">Reservado</div>
                <div className="mt-1 text-xl font-extrabold text-orange-600">{r.total_reserved}</div>
              </div>
            </div>
          </article>
        ))}
        {overview.isLoading && (
          <div className="rounded-3xl border border-dashed border-blue-200 bg-blue-50/50 p-8 text-center text-sm text-muted-foreground">
            Carregando unidades…
          </div>
        )}
      </div>

      <section className="overflow-hidden rounded-3xl border border-violet-200/70 bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-violet-500/10 via-blue-500/5 to-transparent px-5 py-4">
          <div>
            <span className="text-xs font-extrabold text-violet-700">HISTÓRICO OPERACIONAL</span>
            <h2 className="mt-1 font-display text-xl font-extrabold">Últimas movimentações</h2>
          </div>
          <Clock3 className="h-6 w-6 text-violet-600" />
        </div>
        {(movs.data ?? []).length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
        ) : (
          <ul className="divide-y divide-border/70 text-sm">
            {movs.data!.map((m: any) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-5 py-3 transition-colors hover:bg-blue-50/60">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${
                  m.type === "IN" ? "bg-emerald-100 text-emerald-700" :
                  m.type === "OUT" ? "bg-rose-100 text-rose-700" :
                  "bg-violet-100 text-violet-700"
                }`}>{m.type}</span>
                <span className="font-extrabold">{m.qty}</span>
                <span>{m.product?.name} <span className="text-xs text-muted-foreground">({m.product?.sku})</span></span>
                <span className="text-xs text-muted-foreground">@ {m.warehouse?.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("pt-BR")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="devolucoes" className="rounded-3xl border border-orange-200/80 bg-card shadow-sm">
        <div className="flex flex-col gap-2 border-b border-orange-100 bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-extrabold tracking-wide text-orange-700">
              <ArrowLeftRight className="h-4 w-4" /> PRIMEIRA ETAPA IMPLANTADA
            </span>
            <h2 className="mt-1 font-display text-xl font-extrabold">Devoluções, trocas e quarentena</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              A operação é registrada uma única vez: o item revendável volta ao saldo, o defeituoso fica fora do estoque e o substituto é baixado.
            </p>
          </div>
          <ShieldAlert className="hidden h-7 w-7 text-orange-600 sm:block" />
        </div>

        <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              returnMutation.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Tipo da operação
                <select
                  className="mt-1 w-full"
                  value={returnForm.return_type}
                  onChange={(event) => setReturnForm((current) => ({
                    ...current,
                    return_type: event.target.value as typeof current.return_type,
                    resolution: event.target.value === "exchange" ? "replace" : current.resolution,
                  }))}
                >
                  <option value="customer_return">Devolução de cliente</option>
                  <option value="exchange">Troca</option>
                  <option value="supplier_return">Devolução ao fornecedor</option>
                  <option value="defective">Produto com defeito</option>
                </select>
              </label>
              <label className="text-sm font-semibold">
                Depósito
                <select
                  className="mt-1 w-full"
                  value={returnForm.warehouse_id}
                  onChange={(event) => setReturnForm((current) => ({ ...current, warehouse_id: event.target.value }))}
                  required
                >
                  <option value="">Selecione o depósito</option>
                  {warehouseOptions.map((warehouse: any) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.branch_name} · {warehouse.name} ({warehouse.code})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Produto devolvido
                <select
                  className="mt-1 w-full"
                  value={returnForm.returned_product_id}
                  onChange={(event) => setReturnForm((current) => ({ ...current, returned_product_id: event.target.value }))}
                  required
                >
                  <option value="">Selecione o produto</option>
                  {(products.data ?? []).map((product: any) => (
                    <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Quantidade
                <input
                  className="mt-1 w-full"
                  type="number"
                  min="1"
                  step="1"
                  value={returnForm.returned_qty}
                  onChange={(event) => setReturnForm((current) => ({ ...current, returned_qty: event.target.value }))}
                  required
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Condição recebida
                <select
                  className="mt-1 w-full"
                  value={returnForm.condition}
                  onChange={(event) => setReturnForm((current) => ({ ...current, condition: event.target.value as typeof current.condition }))}
                >
                  <option value="resalable">Revender</option>
                  <option value="defective">Defeituoso</option>
                  <option value="quarantine">Aguardando avaliação</option>
                </select>
              </label>
              <label className="text-sm font-semibold">
                Destino do item
                <select
                  className="mt-1 w-full"
                  value={returnForm.resolution}
                  onChange={(event) => setReturnForm((current) => ({ ...current, resolution: event.target.value as typeof current.resolution }))}
                >
                  <option value="restock">Voltar ao estoque</option>
                  <option value="replace">Trocar pelo substituto</option>
                  <option value="quarantine">Enviar para quarentena</option>
                  <option value="supplier_return">Enviar ao fornecedor</option>
                  <option value="discard">Descartar</option>
                </select>
              </label>
            </div>

            {returnForm.return_type === "exchange" && (
              <div className="grid gap-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-3 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  Produto substituto
                  <select
                    className="mt-1 w-full"
                    value={returnForm.replacement_product_id}
                    onChange={(event) => setReturnForm((current) => ({ ...current, replacement_product_id: event.target.value }))}
                    required
                  >
                    <option value="">Selecione o substituto</option>
                    {(products.data ?? []).map((product: any) => (
                      <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Quantidade substituta
                  <input
                    className="mt-1 w-full"
                    type="number"
                    min="1"
                    step="1"
                    value={returnForm.replacement_qty}
                    onChange={(event) => setReturnForm((current) => ({ ...current, replacement_qty: event.target.value }))}
                    required
                  />
                </label>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                ID do pedido (opcional)
                <input
                  className="mt-1 w-full"
                  value={returnForm.order_id}
                  onChange={(event) => setReturnForm((current) => ({ ...current, order_id: event.target.value }))}
                  placeholder="UUID do pedido"
                />
              </label>
              <label className="text-sm font-semibold">
                Motivo
                <input
                  className="mt-1 w-full"
                  value={returnForm.reason}
                  onChange={(event) => setReturnForm((current) => ({ ...current, reason: event.target.value }))}
                  placeholder="Ex.: troca por defeito"
                  required
                />
              </label>
            </div>

            <label className="block text-sm font-semibold">
              Observação (opcional)
              <textarea
                className="mt-1 min-h-20 w-full"
                value={returnForm.notes}
                onChange={(event) => setReturnForm((current) => ({ ...current, notes: event.target.value }))}
                maxLength={2000}
                placeholder="Detalhes para a auditoria"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                A baixa/entrada e a quarentena acontecem juntas, com bloqueio contra estoque negativo.
              </p>
              <button
                type="submit"
                disabled={returnMutation.isPending || warehouseOptions.length === 0 || (products.data ?? []).length === 0}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-orange-600 px-4 text-sm font-extrabold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {returnMutation.isPending ? "Registrando…" : "Registrar operação"}
              </button>
            </div>
          </form>

          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-extrabold">Operações recentes</h3>
                <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-extrabold text-orange-700">
                  {returns.data?.length ?? 0}
                </span>
              </div>
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                {(returns.data ?? []).length === 0 && (
                  <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nenhuma devolução registrada.</p>
                )}
                {(returns.data ?? []).slice(0, 8).map((item: any) => (
                  <div key={item.id} className="rounded-2xl border border-border/70 bg-muted/20 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-extrabold">{item.return_type === "exchange" ? "Troca" : item.return_type === "customer_return" ? "Devolução de cliente" : item.return_type === "supplier_return" ? "Fornecedor" : "Defeito"}</span>
                      <span className="text-xs font-bold text-emerald-700">Concluída</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.reason}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {item.warehouse?.name ?? "Depósito"} · {new Date(item.created_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-extrabold">Quarentena</h3>
                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-extrabold text-rose-700">
                  {(quarantine.data ?? []).filter((item: any) => item.status === "pending").length} pendentes
                </span>
              </div>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {(quarantine.data ?? []).filter((item: any) => item.status === "pending").slice(0, 6).map((item: any) => (
                  <div key={item.id} className="rounded-2xl border border-rose-200 bg-rose-50/60 p-3 text-xs">
                    <div className="font-extrabold">{item.product?.name ?? "Produto"} · {item.product?.sku ?? "—"}</div>
                    <div className="mt-1 text-rose-800">{item.quantity} un. · {item.reason}</div>
                    <div className="mt-1 text-muted-foreground">{item.warehouse?.name ?? "Depósito"}</div>
                  </div>
                ))}
                {(quarantine.data ?? []).filter((item: any) => item.status === "pending").length === 0 && (
                  <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nenhum item em quarentena.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <p className="rounded-2xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
        Para ajustar o estoque de um produto específico, use a página do produto. O estoque legado em <code>products.stock</code> continua funcionando; a nova estrutura é aditiva.
      </p>
    </div>
  );
}
