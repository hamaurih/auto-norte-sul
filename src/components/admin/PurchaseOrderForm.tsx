import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  listSuppliers,
  listSupplyWarehouses,
  savePurchaseOrder,
  searchSupplyProducts,
} from "@/lib/supplies.functions";
import { brl } from "@/lib/format";
import { num } from "@/lib/supplies-ui";

export type PurchaseOrderItemRow = {
  product_id: string;
  label: string;
  sku: string;
  ordered_qty: number;
  unit_cost: number;
};

export type PurchaseOrderFormInitial = {
  id: string;
  supplier_id: string;
  warehouse_id: string;
  expected_at: string;
  payment_terms: string;
  freight_amount: number;
  discount_amount: number;
  other_amount: number;
  notes: string;
  items: PurchaseOrderItemRow[];
};

export function PurchaseOrderForm({ initial }: { initial?: PurchaseOrderFormInitial }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const suppliersFn = useServerFn(listSuppliers);
  const warehousesFn = useServerFn(listSupplyWarehouses);
  const searchFn = useServerFn(searchSupplyProducts);
  const saveFn = useServerFn(savePurchaseOrder);

  const isEdit = Boolean(initial?.id);

  const [supplierId, setSupplierId] = useState(initial?.supplier_id ?? "");
  const [warehouseId, setWarehouseId] = useState(initial?.warehouse_id ?? "");
  const [expectedAt, setExpectedAt] = useState(initial?.expected_at ?? "");
  const [paymentTerms, setPaymentTerms] = useState(initial?.payment_terms ?? "");
  const [freight, setFreight] = useState(String(initial?.freight_amount ?? 0));
  const [discount, setDiscount] = useState(String(initial?.discount_amount ?? 0));
  const [other, setOther] = useState(String(initial?.other_amount ?? 0));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<PurchaseOrderItemRow[]>(initial?.items ?? []);

  const { data: suppliers, isLoading: loadingSuppliers } = useQuery({
    queryKey: ["suppliers", "active-only"],
    queryFn: () => suppliersFn({ data: { onlyActive: true } }),
  });
  const { data: warehouses } = useQuery({
    queryKey: ["supply-warehouses"],
    queryFn: () => warehousesFn(),
  });
  const { data: results, isFetching } = useQuery({
    queryKey: ["supply-product-search", term],
    queryFn: () => searchFn({ data: { search: term } }),
    enabled: term.trim().length >= 2,
  });

  const itemsTotal = items.reduce((sum, item) => sum + item.ordered_qty * item.unit_cost, 0);
  const total = Math.max(0, itemsTotal + num(freight) + num(other) - num(discount));

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...(initial?.id ? { id: initial.id } : {}),
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          expected_at: expectedAt || null,
          payment_terms: paymentTerms || null,
          freight_amount: num(freight),
          discount_amount: num(discount),
          other_amount: num(other),
          notes: notes || null,
          items: items.map((item) => ({
            product_id: item.product_id,
            ordered_qty: item.ordered_qty,
            unit_cost: item.unit_cost,
          })),
        },
      }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-order"] });
      qc.invalidateQueries({ queryKey: ["supplies-overview"] });
      toast.success(isEdit ? "Pedido de compra atualizado" : "Pedido de compra criado como rascunho");
      void navigate({ to: "/admin/pedidos-compra/$id", params: { id: result.id ?? initial?.id ?? "" } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addItem = (product: any) => {
    setItems((current) => {
      const existing = current.find((item) => item.product_id === product.id);
      if (existing) {
        return current.map((item) =>
          item.product_id === product.id ? { ...item, ordered_qty: item.ordered_qty + 1 } : item,
        );
      }
      return [
        ...current,
        {
          product_id: product.id,
          label: product.name,
          sku: product.sku,
          ordered_qty: 1,
          unit_cost: Number(product.last_purchase_cost ?? product.average_cost ?? 0),
        },
      ];
    });
    setTerm("");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase">
            {isEdit ? "Editar pedido de compra" : "Novo pedido de compra"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            O pedido nasce como rascunho e só movimenta estoque após o recebimento ser confirmado.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/pedidos-compra">Voltar</Link>
        </Button>
      </header>

      <section className="grid gap-2 rounded-lg border border-border bg-card p-4 md:grid-cols-3">
        <label className="text-xs font-semibold uppercase text-muted-foreground md:col-span-3">
          Fornecedor e destino
        </label>
        <select
          aria-label="Fornecedor"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
        >
          <option value="">
            {loadingSuppliers ? "Carregando fornecedores…" : "Selecione o fornecedor…"}
          </option>
          {(suppliers ?? []).map((supplier: any) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.legal_name}
            </option>
          ))}
        </select>
        <select
          aria-label="Depósito de entrada"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
        >
          <option value="">Depósito de entrada…</option>
          {(warehouses ?? []).map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name} {warehouse.branch_name ? `· ${warehouse.branch_name}` : ""}
            </option>
          ))}
        </select>
        <Input
          type="date"
          aria-label="Previsão de entrega"
          value={expectedAt}
          onChange={(event) => setExpectedAt(event.target.value)}
        />
        <Input
          className="md:col-span-3"
          placeholder="Condições de pagamento"
          value={paymentTerms}
          onChange={(event) => setPaymentTerms(event.target.value)}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-lg font-bold">Itens</h2>
        <Input
          className="mt-2"
          placeholder="Buscar produto por nome, SKU, código interno ou do fabricante"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        {term.trim().length >= 2 && (
          <div className="mt-2 max-h-60 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {isFetching && <p className="text-xs text-muted-foreground">Buscando…</p>}
            {!isFetching && (results ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum produto encontrado.</p>
            )}
            {(results ?? []).map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addItem(product)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span className="min-w-0 truncate">
                  {product.name}
                  <span className="ml-2 text-xs text-muted-foreground">{product.sku}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  último custo {product.last_purchase_cost == null ? "—" : brl(product.last_purchase_cost)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 space-y-2">
          {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhum item adicionado.</p>}
          {items.map((item, index) => (
            <div
              key={item.product_id}
              className="grid grid-cols-[minmax(0,1fr)_80px_110px_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_90px_120px_110px_auto]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.sku}</div>
              </div>
              <Input
                inputMode="decimal"
                aria-label={`Quantidade de ${item.sku}`}
                value={String(item.ordered_qty)}
                onChange={(event) => {
                  const value = num(event.target.value.replace(",", "."));
                  setItems((current) =>
                    current.map((row, rowIndex) => (rowIndex === index ? { ...row, ordered_qty: value } : row)),
                  );
                }}
              />
              <Input
                inputMode="decimal"
                aria-label={`Custo unitário de ${item.sku}`}
                value={String(item.unit_cost)}
                onChange={(event) => {
                  const value = num(event.target.value.replace(",", "."));
                  setItems((current) =>
                    current.map((row, rowIndex) => (rowIndex === index ? { ...row, unit_cost: value } : row)),
                  );
                }}
              />
              <span className="hidden text-sm font-semibold sm:block">
                {brl(item.ordered_qty * item.unit_cost)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover ${item.label}`}
                onClick={() => setItems((current) => current.filter((_, rowIndex) => rowIndex !== index))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-2 rounded-lg border border-border bg-card p-4 md:grid-cols-4">
        <label className="md:col-span-4 text-xs font-semibold uppercase text-muted-foreground">
          Encargos e totais
        </label>
        <Input placeholder="Frete" aria-label="Frete" inputMode="decimal" value={freight} onChange={(event) => setFreight(event.target.value)} />
        <Input placeholder="Outros" aria-label="Outros valores" inputMode="decimal" value={other} onChange={(event) => setOther(event.target.value)} />
        <Input placeholder="Desconto" aria-label="Desconto" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} />
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Itens {brl(itemsTotal)}</div>
          <div className="font-display text-xl font-bold">{brl(total)}</div>
        </div>
        <Textarea
          className="md:col-span-4"
          placeholder="Observações do pedido"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </section>

      <div className="flex justify-end gap-2">
        <Button
          disabled={save.isPending || items.length === 0 || !supplierId || !warehouseId}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Salvando…" : isEdit ? "Salvar alterações" : "Salvar rascunho"}
        </Button>
      </div>
    </div>
  );
}
