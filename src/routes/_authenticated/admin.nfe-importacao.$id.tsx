import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Images, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { ProductCodeBadges } from "@/components/admin/ProductCodeBadges";
import {
  cancelNfeImport,
  createReceiptFromNfe,
  createSupplierFromNfe,
  getNfeImport,
  setNfeItemProduct,
  setNfePurchaseOrder,
} from "@/lib/nfe.functions";
import { listPurchaseOrders, listSupplyWarehouses, searchSupplyProducts } from "@/lib/supplies.functions";
import { formatAccessKey, matchSourceLabel, nfeStatusClass, nfeStatusLabel } from "@/lib/nfe-ui";
import { formatDate, num } from "@/lib/supplies-ui";
import { brl } from "@/lib/format";
import { enqueueNfeItemEnrichment } from "@/lib/product-enrichment.functions";

export const Route = createFileRoute("/_authenticated/admin/nfe-importacao/$id")({
  head: () => ({
    meta: [
      { title: "Conferência de NF-e · Admin" },
      { name: "description", content: "Conferência de itens da NF-e de compra antes de gerar o recebimento." },
    ],
  }),
  component: GuardedNfeDetail,
});

const EDITABLE = ["importado", "em_conferencia", "divergente", "pronto"];

type NfePackagingRow = {
  receivedPackages: string;
  rejectedPackages: string;
  unitsPerPackage: string;
  packageUnit: string;
};

function parseNfeQuantity(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultNfePackaging(item: any): NfePackagingRow {
  return {
    receivedPackages: String(item.qty ?? ""),
    rejectedPackages: "0",
    unitsPerPackage: "1",
    packageUnit: String(item.unit ?? "UN").trim().toUpperCase() || "UN",
  };
}

function NfeDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const getFn = useServerFn(getNfeImport);
  const searchFn = useServerFn(searchSupplyProducts);
  const setItemFn = useServerFn(setNfeItemProduct);
  const setOrderFn = useServerFn(setNfePurchaseOrder);
  const createSupplierFn = useServerFn(createSupplierFromNfe);
  const createReceiptFn = useServerFn(createReceiptFromNfe);
  const cancelFn = useServerFn(cancelNfeImport);
  const enqueueEnrichmentFn = useServerFn(enqueueNfeItemEnrichment);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["nfe-import", id],
    queryFn: () => getFn({ data: { id } }),
  });

  const header = (data as any)?.header;
  const items = ((data as any)?.items ?? []) as any[];
  const editable = header ? EDITABLE.includes(header.status) : false;

  const { data: orders } = useQuery({
    queryKey: ["purchase-orders", "open"],
    queryFn: () => listPurchaseOrders({ data: { status: "open" } }),
    enabled: editable,
  });
  const { data: warehouses } = useQuery({
    queryKey: ["supply-warehouses"],
    queryFn: () => listSupplyWarehouses(),
    enabled: editable,
  });

  const [noOrderReason, setNoOrderReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [packaging, setPackaging] = useState<Record<string, NfePackagingRow>>({});

  const { data: results, isFetching: searching } = useQuery({
    queryKey: ["nfe-product-search", term],
    queryFn: () => searchFn({ data: { search: term } }),
    enabled: activeItem != null && term.trim().length >= 2,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["nfe-import", id] });
    queryClient.invalidateQueries({ queryKey: ["nfe-imports"] });
  };

  const linkProduct = useMutation({
    mutationFn: (input: { itemId: string; productId: string | null; remember?: boolean }) =>
      setItemFn({ data: { importId: id, ...input } }),
    onSuccess: () => {
      setActiveItem(null);
      setTerm("");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const linkOrder = useMutation({
    mutationFn: (input: { purchaseOrderId: string | null; warehouseId?: string | null; noOrderReason?: string }) =>
      setOrderFn({ data: { importId: id, ...input } }),
    onSuccess: () => {
      toast.success("Conferência atualizada.");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const assistedSupplier = useMutation({
    mutationFn: () => createSupplierFn({ data: { importId: id, confirm: true } }),
    onSuccess: (result: any) => {
      toast.success(result.created ? "Fornecedor cadastrado a partir da NF-e." : "Fornecedor vinculado.");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const generateReceipt = useMutation({
    mutationFn: () =>
      createReceiptFn({
        data: {
          importId: id,
          packaging: Object.fromEntries(
            items.map((item) => {
              const row = packaging[item.id] ?? defaultNfePackaging(item);
              return [
                item.id,
                {
                  receivedPackageQty: parseNfeQuantity(row.receivedPackages),
                  rejectedPackageQty: parseNfeQuantity(row.rejectedPackages),
                  unitsPerPackage: parseNfeQuantity(row.unitsPerPackage),
                  packageUnit: row.packageUnit,
                },
              ];
            }),
          ),
        },
      }),
    onSuccess: (result: any) => {
      toast.success("Recebimento em rascunho criado. Confirme para atualizar estoque e custo.");
      invalidate();
      navigate({ to: "/admin/recebimentos/$id", params: { id: result.receiptId } });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancelImport = useMutation({
    mutationFn: () => cancelFn({ data: { importId: id, reason: cancelReason } }),
    onSuccess: () => {
      toast.success("Importação cancelada.");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const enqueueEnrichment = useMutation({
    mutationFn: (nfeItemId: string) => enqueueEnrichmentFn({ data: { nfeItemId } }),
    onSuccess: (result) => {
      toast.success(result.reused ? "Produto já estava na fila de enriquecimento" : "Busca de imagem e dados preparada");
      window.open("/admin/enriquecimento-produtos", "_blank", "noopener,noreferrer");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const pending = useMemo(() => items.filter((item) => !item.product_id).length, [items]);
  const divergent = useMemo(
    () => items.filter((item) => (item.divergences ?? []).length > 0).length,
    [items],
  );
  const conversionIssues = useMemo(
    () =>
      items.filter((item) => {
        const row = packaging[item.id] ?? defaultNfePackaging(item);
        const receivedPackages = parseNfeQuantity(row.receivedPackages);
        const rejectedPackages = parseNfeQuantity(row.rejectedPackages);
        const unitsPerPackage = parseNfeQuantity(row.unitsPerPackage);
        const convertedTotal = receivedPackages * unitsPerPackage;
        return (
          receivedPackages <= 0 ||
          rejectedPackages < 0 ||
          unitsPerPackage <= 0 ||
          rejectedPackages > receivedPackages ||
          Math.abs(convertedTotal - num(item.qty)) > 0.01
        );
      }).length,
    [items, packaging],
  );

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando NF-e…</p>;
  if (isError || !header) {
    return (
      <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
        {(error as Error)?.message ?? "Importação de NF-e não encontrada."}
      </div>
    );
  }

  const eligibleOrders = ((orders ?? []) as any[]).filter(
    (order) =>
      ["approved", "sent", "partially_received"].includes(order.status) &&
      (!header.supplier_id || order.supplier_id === header.supplier_id),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to="/admin/nfe-importacao" className="inline-flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" aria-hidden="true" /> Voltar
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold uppercase">
            NF-e {header.nfe_number}/{header.nfe_series}
          </h1>
          <p className="text-xs text-muted-foreground">{formatAccessKey(header.access_key)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {header.emitter_name} · emissão {formatDate(header.issued_at)} · {header.items_count} itens ·{" "}
            {brl(Number(header.total_invoice ?? 0))}
          </p>
        </div>
        <span
          className={`rounded-md px-2 py-1 text-xs font-semibold uppercase ${
            nfeStatusClass[header.status] ?? "bg-muted text-muted-foreground"
          }`}
        >
          {nfeStatusLabel[header.status] ?? header.status}
        </span>
      </header>

      {/* Fornecedor */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-sm font-bold uppercase">Fornecedor</h2>
        {header.supplier ? (
          <p className="mt-1 text-sm">
            {header.supplier.legal_name}
            {header.supplier.trade_name ? ` (${header.supplier.trade_name})` : ""} · {header.supplier.tax_id}
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-muted-foreground">
              Emitente <strong>{header.emitter_name}</strong> ({header.emitter_tax_id}) não está cadastrado.
            </p>
            {editable && (
              <Button size="sm" onClick={() => assistedSupplier.mutate()} disabled={assistedSupplier.isPending}>
                {assistedSupplier.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Cadastrar fornecedor com os dados da NF-e
              </Button>
            )}
          </div>
        )}
      </section>

      {/* Vínculo com pedido de compra */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-sm font-bold uppercase">Pedido de compra</h2>
        {header.purchase_order ? (
          <p className="text-sm">
            Vinculado ao pedido #{header.purchase_order.number} ({header.purchase_order.status})
          </p>
        ) : header.no_order_reason ? (
          <p className="text-sm">
            Entrada avulsa justificada: <span className="text-muted-foreground">{header.no_order_reason}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Selecione o pedido ou justifique a entrada avulsa.</p>
        )}

        {editable && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="nfe-order">Vincular a um pedido aberto</Label>
              <select
                id="nfe-order"
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={header.purchase_order_id ?? ""}
                onChange={(event) =>
                  linkOrder.mutate({ purchaseOrderId: event.target.value || null, noOrderReason: noOrderReason })
                }
              >
                <option value="">— Sem pedido (entrada avulsa) —</option>
                {eligibleOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    #{order.number} · {order.supplier?.legal_name} · {brl(Number(order.total_amount ?? 0))}
                  </option>
                ))}
              </select>
            </div>

            {!header.purchase_order_id && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="nfe-warehouse">Depósito de entrada</Label>
                  <select
                    id="nfe-warehouse"
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                    value={header.warehouse_id ?? ""}
                    onChange={(event) =>
                      linkOrder.mutate({
                        purchaseOrderId: null,
                        warehouseId: event.target.value || null,
                        noOrderReason: header.no_order_reason ?? noOrderReason,
                      })
                    }
                  >
                    <option value="">Selecione…</option>
                    {((warehouses ?? []) as any[]).map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name} ({warehouse.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="nfe-reason">Justificativa da entrada sem pedido</Label>
                  <Textarea
                    id="nfe-reason"
                    rows={2}
                    value={noOrderReason || (header.no_order_reason ?? "")}
                    onChange={(event) => setNoOrderReason(event.target.value)}
                    placeholder="Ex.: compra emergencial autorizada pela gerência."
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={linkOrder.isPending || !noOrderReason.trim()}
                    onClick={() => linkOrder.mutate({ purchaseOrderId: null, noOrderReason })}
                  >
                    Salvar justificativa
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* Itens */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold uppercase">Itens da nota</h2>
          <p className="text-xs text-muted-foreground">
            {pending} sem vínculo · {divergent} com divergência
          </p>
        </div>

        {items.map((item) => {
          const divergences = (item.divergences ?? []) as { kind: string; message: string }[];
          const packagingRow = packaging[item.id] ?? defaultNfePackaging(item);
          const receivedPackages = parseNfeQuantity(packagingRow.receivedPackages);
          const rejectedPackages = parseNfeQuantity(packagingRow.rejectedPackages);
          const unitsPerPackage = parseNfeQuantity(packagingRow.unitsPerPackage);
          const convertedTotal = receivedPackages * unitsPerPackage;
          const acceptedUnits = Math.max(0, (receivedPackages - rejectedPackages) * unitsPerPackage);
          const rejectedUnits = Math.max(0, rejectedPackages * unitsPerPackage);
          const conversionMatches = Math.abs(convertedTotal - num(item.qty)) <= 0.01;
          const updatePackaging = (patch: Partial<NfePackagingRow>) =>
            setPackaging((current) => ({
              ...current,
              [item.id]: { ...packagingRow, ...patch },
            }));
          return (
            <article key={item.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Linha {item.line_number}</div>
                  <div className="font-semibold">{item.description}</div>
                  <div className="text-xs text-muted-foreground">
                    Cód. fornecedor {item.supplier_code ?? "—"} · GTIN {item.gtin ?? "—"} · {item.qty} {item.unit} ·{" "}
                    {brl(Number(item.unit_value))} un · total {brl(Number(item.total_amount))}
                  </div>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
                  {matchSourceLabel[item.match_source] ?? item.match_source}
                </span>
              </div>

              <div className="mt-3 rounded-md border border-border/60 bg-background p-3">
                {item.product ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{item.product.name}</div>
                      <ProductCodeBadges
                        internalCode={item.product.internal_code}
                        manufacturerCode={item.product.manufacturer_code}
                        sku={item.product.sku}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={enqueueEnrichment.isPending}
                        onClick={() => enqueueEnrichment.mutate(item.id)}
                      >
                        <Images className="mr-2 h-4 w-4" aria-hidden="true" />
                        Buscar imagem e dados
                      </Button>
                      {editable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setActiveItem(item.id);
                            setTerm(item.supplier_code ?? item.description.slice(0, 20));
                          }}
                        >
                          Trocar produto
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-hot">Item ainda sem produto vinculado.</p>
                    {editable && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setActiveItem(item.id);
                          setTerm(item.supplier_code ?? item.description.slice(0, 20));
                        }}
                      >
                        <Search className="mr-2 h-4 w-4" aria-hidden="true" /> Vincular produto
                      </Button>
                    )}
                  </div>
                )}

                {activeItem === item.id && (
                  <div className="mt-3 space-y-2">
                    <Input
                      autoFocus
                      value={term}
                      onChange={(event) => setTerm(event.target.value)}
                      placeholder="Buscar por nome, código interno, fabricante ou SKU"
                    />
                    {searching && <p className="text-xs text-muted-foreground">Buscando…</p>}
                    <div className="max-h-64 space-y-1 overflow-auto">
                      {((results ?? []) as any[]).map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          className="w-full rounded-md border border-border p-2 text-left text-sm hover:border-primary/50"
                          onClick={() =>
                            linkProduct.mutate({ itemId: item.id, productId: product.id, remember: true })
                          }
                        >
                          <div className="font-semibold">{product.name}</div>
                          <ProductCodeBadges
                            internalCode={product.internal_code}
                            manufacturerCode={product.manufacturer_code}
                            sku={product.sku}
                          />
                        </button>
                      ))}
                      {!searching && term.trim().length >= 2 && ((results ?? []) as any[]).length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          Nenhum produto encontrado. Cadastre a peça no catálogo antes de conferir esta linha.
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setActiveItem(null)}>
                        Cancelar
                      </Button>
                      {item.product_id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => linkProduct.mutate({ itemId: item.id, productId: null })}
                        >
                          Remover vínculo
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {editable && (
                <div className="mt-3 rounded-md border border-blue-200 bg-blue-50/60 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-bold uppercase text-blue-950">Conversão de embalagem</h3>
                      <p className="mt-1 text-xs text-blue-900/80">
                        NF-e: {num(item.qty).toLocaleString("pt-BR")} {item.unit ?? "UN"} · exemplo: 100 CX x 10 UN = 1.000 UN.
                      </p>
                    </div>
                    <span
                      className={conversionMatches ? "rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800" : "rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800"}
                    >
                      {conversionMatches ? "Total confere" : "Ajuste necessário"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <label className="text-xs font-semibold text-blue-950">
                      Embalagens recebidas
                      <Input
                        aria-label={"Embalagens recebidas da linha " + item.line_number}
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={packagingRow.receivedPackages}
                        onChange={(event) => updatePackaging({ receivedPackages: event.target.value })}
                      />
                    </label>
                    <label className="text-xs font-semibold text-blue-950">
                      Recusadas
                      <Input
                        aria-label={"Embalagens recusadas da linha " + item.line_number}
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={packagingRow.rejectedPackages}
                        onChange={(event) => updatePackaging({ rejectedPackages: event.target.value })}
                      />
                    </label>
                    <label className="text-xs font-semibold text-blue-950">
                      Unidades por embalagem
                      <Input
                        aria-label={"Unidades por embalagem da linha " + item.line_number}
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={packagingRow.unitsPerPackage}
                        onChange={(event) => updatePackaging({ unitsPerPackage: event.target.value })}
                      />
                    </label>
                    <label className="text-xs font-semibold text-blue-950">
                      Unidade da embalagem
                      <select
                        aria-label={"Unidade da embalagem da linha " + item.line_number}
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={packagingRow.packageUnit}
                        onChange={(event) => updatePackaging({ packageUnit: event.target.value })}
                      >
                        <option value="UN">UN</option>
                        <option value="CX">CX</option>
                        <option value="FD">FD</option>
                        <option value="KIT">KIT</option>
                        <option value="PCT">PCT</option>
                        <option value="PAR">PAR</option>
                        <option value="JOGO">JOGO</option>
                        <option value="MIL">MIL</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                    <span>Recebido convertido: <strong>{acceptedUnits.toLocaleString("pt-BR")}</strong> UN</span>
                    <span>Recusado convertido: <strong>{rejectedUnits.toLocaleString("pt-BR")}</strong> UN</span>
                    <span>Total físico: <strong>{convertedTotal.toLocaleString("pt-BR")}</strong> UN</span>
                  </div>
                  {!conversionMatches && (
                    <p className="mt-2 text-xs font-semibold text-amber-900">
                      A conversão precisa totalizar {num(item.qty).toLocaleString("pt-BR")} unidades-base da NF-e antes de gerar o recebimento.
                    </p>
                  )}
                </div>
              )}

              {divergences.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {divergences.map((divergence, index) => (
                    <li key={`${item.id}-${index}`} className="flex items-start gap-2 text-xs text-hot">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{divergence.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </section>

      {/* Ações */}
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-sm font-bold uppercase">Gerar recebimento</h2>
        {header.goods_receipt ? (
          <p className="text-sm">
            Recebimento #{header.goods_receipt.number} ({header.goods_receipt.status}) ·{" "}
            <Link
              to="/admin/recebimentos/$id"
              params={{ id: header.goods_receipt.id }}
              className="font-semibold text-primary underline"
            >
              abrir
            </Link>
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              O recebimento é criado em rascunho. O estoque e o custo médio só são atualizados ao confirmar o
              recebimento.
            </p>
            <Button
              onClick={() => generateReceipt.mutate()}
              disabled={!editable || pending > 0 || conversionIssues > 0 || generateReceipt.isPending}
            >
              {generateReceipt.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Gerar recebimento
            </Button>
            {pending > 0 && (
              <p className="text-xs text-hot">Vincule todos os itens antes de gerar o recebimento.</p>
            )}
            {conversionIssues > 0 && (
              <p className="text-xs text-hot">
                Ajuste a conversão das linhas destacadas para que o total físico seja igual ao total da NF-e.
              </p>
            )}
          </>
        )}

        {editable && (
          <div className="space-y-2 border-t border-border pt-3">
            <Label htmlFor="nfe-cancel">Cancelar importação</Label>
            <Input
              id="nfe-cancel"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Motivo do cancelamento"
            />
            <Button
              variant="destructive"
              size="sm"
              disabled={!cancelReason.trim() || cancelImport.isPending}
              onClick={() => cancelImport.mutate()}
            >
              Cancelar importação
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function GuardedNfeDetail() {
  return (
    <SupplyGuard>
      <NfeDetail />
    </SupplyGuard>
  );
}
