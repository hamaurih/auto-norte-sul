/**
 * QuoteForm — criação e edição de orçamento/proposta comercial.
 * Não cria cobrança: apenas o documento comercial.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Trash2, Save, FileCheck2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { brl } from "@/lib/format";
import { isoDateInDays, QUOTE_ORIGIN_LABEL, statusLabel, statusTone } from "@/lib/quotes-ui";
import {
  getQuoteContext,
  searchQuoteCustomers,
  searchQuoteProducts,
  upsertQuote,
} from "@/lib/quotes.functions";

type ItemRow = {
  product_id: string | null;
  sku: string | null;
  name: string;
  qty: number;
  unit_price: number;
  discount: number;
  notes: string | null;
  available?: number | null;
};

export type QuoteFormValues = {
  id?: string;
  title: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  sales_rep_id: string;
  branch_id: string;
  origin: string;
  discount: number;
  shipping_amount: number;
  payment_terms: string;
  delivery_terms: string;
  internal_notes: string;
  customer_notes: string;
  valid_until: string;
  follow_up_at: string;
  items: ItemRow[];
};

function emptyValues(): QuoteFormValues {
  return {
    title: "",
    customer_id: null,
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    sales_rep_id: "",
    branch_id: "",
    origin: "vendedor",
    discount: 0,
    shipping_amount: 0,
    payment_terms: "",
    delivery_terms: "",
    internal_notes: "",
    customer_notes: "",
    valid_until: isoDateInDays(7),
    follow_up_at: "",
    items: [],
  };
}

export function quoteToFormValues(quote: any): QuoteFormValues {
  return {
    id: quote.id,
    title: quote.title ?? "",
    customer_id: quote.customer_id ?? null,
    customer_name: quote.customer_name ?? "",
    customer_email: quote.customer_email ?? "",
    customer_phone: quote.customer_phone ?? "",
    sales_rep_id: quote.sales_rep_id ?? "",
    branch_id: quote.branch_id ?? "",
    origin: quote.origin ?? "vendedor",
    discount: Number(quote.discount ?? 0),
    shipping_amount: Number(quote.shipping_amount ?? 0),
    payment_terms: quote.payment_terms ?? "",
    delivery_terms: quote.delivery_terms ?? "",
    internal_notes: quote.internal_notes ?? "",
    customer_notes: quote.customer_notes ?? "",
    valid_until: (quote.valid_until ?? "").slice(0, 10),
    follow_up_at: (quote.follow_up_at ?? "").slice(0, 10),
    items: (quote.items ?? []).map((item: any) => ({
      product_id: item.product_id ?? null,
      sku: item.sku ?? null,
      name: item.name,
      qty: Number(item.qty ?? 1),
      unit_price: Number(item.unit_price ?? 0),
      discount: Number(item.discount ?? 0),
      notes: item.notes ?? null,
    })),
  };
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <header className="mb-4">
        <h2 className="font-display text-base font-bold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function QuoteForm({
  initial,
  status,
  onSaved,
  onGenerateProposal,
  generating,
}: {
  initial?: any;
  status?: string | null;
  onSaved?: (id: string) => void;
  onGenerateProposal?: (id: string) => void;
  generating?: boolean;
}) {
  const [form, setForm] = useState<QuoteFormValues>(() =>
    initial ? quoteToFormValues(initial) : emptyValues(),
  );
  const [customerQuery, setCustomerQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const contextFn = useServerFn(getQuoteContext);
  const searchCustomersFn = useServerFn(searchQuoteCustomers);
  const searchProductsFn = useServerFn(searchQuoteProducts);
  const saveFn = useServerFn(upsertQuote);

  const { data: ctx } = useQuery({ queryKey: ["quote-context"], queryFn: () => contextFn({} as any) });

  useEffect(() => {
    if (!ctx || form.sales_rep_id || form.id) return;
    if (ctx.currentRep?.id) setForm((prev) => ({ ...prev, sales_rep_id: ctx.currentRep!.id }));
  }, [ctx, form.sales_rep_id, form.id]);

  const { data: customers, isFetching: findingCustomers } = useQuery({
    queryKey: ["quote-customers", customerQuery],
    queryFn: () => searchCustomersFn({ data: { q: customerQuery } }),
    enabled: customerQuery.trim().length >= 2,
  });

  const { data: products, isFetching: findingProducts } = useQuery({
    queryKey: ["quote-products", productQuery],
    queryFn: () => searchProductsFn({ data: { q: productQuery } }),
    enabled: productQuery.trim().length >= 2,
  });

  const totals = useMemo(() => {
    const gross = form.items.reduce((sum, item) => sum + item.qty * item.unit_price, 0);
    const itemsDiscount = form.items.reduce((sum, item) => sum + (item.discount || 0), 0);
    const subtotal = Math.max(gross - itemsDiscount, 0);
    const total = Math.max(subtotal - (form.discount || 0), 0) + (form.shipping_amount || 0);
    return { gross, itemsDiscount, subtotal, total };
  }, [form]);

  const stockAlert = form.items.filter(
    (item) => typeof item.available === "number" && item.qty > (item.available ?? 0),
  );

  const set = <K extends keyof QuoteFormValues>(key: K, value: QuoteFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addProduct = (product: any) => {
    setForm((prev) => {
      const index = prev.items.findIndex((item) => item.product_id === product.id);
      if (index >= 0) {
        const items = [...prev.items];
        items[index] = { ...items[index], qty: items[index].qty + 1 };
        return { ...prev, items };
      }
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            product_id: product.id,
            sku: product.sku ?? null,
            name: product.name,
            qty: 1,
            unit_price: Number(product.price ?? 0),
            discount: 0,
            notes: null,
            available: Number(product.available ?? 0),
          },
        ],
      };
    });
    setProductQuery("");
  };

  const updateItem = (index: number, patch: Partial<ItemRow>) =>
    setForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], ...patch };
      return { ...prev, items };
    });

  const removeItem = (index: number) =>
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));

  const buildPayload = () => ({
    id: form.id,
    title: form.title.trim() || null,
    customer_id: form.customer_id,
    customer_name: form.customer_name.trim() || null,
    customer_email: form.customer_email.trim() || null,
    customer_phone: form.customer_phone.trim() || null,
    sales_rep_id: form.sales_rep_id || null,
    branch_id: form.branch_id || null,
    origin: form.origin as any,
    discount: Number(form.discount || 0),
    shipping_amount: Number(form.shipping_amount || 0),
    payment_terms: form.payment_terms.trim() || null,
    delivery_terms: form.delivery_terms.trim() || null,
    internal_notes: form.internal_notes.trim() || null,
    customer_notes: form.customer_notes.trim() || null,
    valid_until: form.valid_until || null,
    follow_up_at: form.follow_up_at || null,
    items: form.items.map((item) => ({
      product_id: item.product_id,
      sku: item.sku,
      name: item.name,
      qty: Number(item.qty),
      unit_price: Number(item.unit_price),
      discount: Number(item.discount || 0),
      notes: item.notes,
    })),
  });

  const validateLocally = () => {
    for (const item of form.items) {
      if (!(item.qty > 0)) throw new Error(`Quantidade inválida em "${item.name}".`);
      if (!(item.unit_price >= 0)) throw new Error(`Preço inválido em "${item.name}".`);
      if (item.discount < 0) throw new Error(`Desconto inválido em "${item.name}".`);
    }
    if (form.discount < 0 || form.shipping_amount < 0) throw new Error("Valores negativos não são permitidos.");
  };

  const save = async (thenProposal = false) => {
    setSaving(true);
    try {
      validateLocally();
      const result = await saveFn({ data: buildPayload() as any });
      setForm((prev) => ({ ...prev, id: result.id }));
      toast.success("Orçamento salvo.");
      if (thenProposal) onGenerateProposal?.(result.id);
      else onSaved?.(result.id);
    } catch (error) {
      toast.error((error as Error).message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <SectionCard title="Cliente" description="Busque no cadastro ou registre um contato avulso.">
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar cliente por nome, documento, telefone ou e-mail"
                value={customerQuery}
                onChange={(event) => setCustomerQuery(event.target.value)}
              />
              {customerQuery.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-popover shadow-lg">
                  {findingCustomers && <p className="p-3 text-xs text-muted-foreground">Buscando…</p>}
                  {!findingCustomers && (customers ?? []).length === 0 && (
                    <p className="p-3 text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
                  )}
                  {(customers ?? []).map((customer: any) => (
                    <button
                      key={customer.id}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          customer_id: customer.id,
                          customer_name: customer.name ?? "",
                          customer_email: customer.email ?? "",
                          customer_phone: customer.phone ?? "",
                        }));
                        setCustomerQuery("");
                      }}
                    >
                      <span className="font-semibold">{customer.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[customer.document, customer.phone, customer.email].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="q-name">Nome do cliente</Label>
                <Input
                  id="q-name"
                  value={form.customer_name}
                  onChange={(event) => set("customer_name", event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="q-email">E-mail</Label>
                <Input id="q-email" value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="q-phone">Telefone</Label>
                <Input id="q-phone" value={form.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} />
              </div>
            </div>
            {form.customer_id && (
              <p className="text-xs text-muted-foreground">
                Vinculado ao cadastro de clientes.{" "}
                <button type="button" className="underline" onClick={() => set("customer_id", null)}>
                  desvincular
                </button>
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Responsável e origem">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label htmlFor="q-title">Título da negociação</Label>
              <Input id="q-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <Label htmlFor="q-rep">Vendedor</Label>
              <select
                id="q-rep"
                className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={form.sales_rep_id}
                onChange={(e) => set("sales_rep_id", e.target.value)}
                disabled={ctx ? !ctx.canChooseRep && !!ctx.currentRep : false}
              >
                <option value="">Sem vendedor</option>
                {(ctx?.reps ?? []).map((rep: any) => (
                  <option key={rep.id} value={rep.id}>{rep.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="q-branch">Filial</Label>
              <select
                id="q-branch"
                className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={form.branch_id}
                onChange={(e) => set("branch_id", e.target.value)}
              >
                <option value="">Não informada</option>
                {(ctx?.branches ?? []).map((branch: any) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="q-origin">Origem</Label>
              <select
                id="q-origin"
                className="h-10 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={form.origin}
                onChange={(e) => set("origin", e.target.value)}
              >
                {Object.entries(QUOTE_ORIGIN_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Itens" description="Busque por nome, SKU, código interno ou código do fabricante.">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Adicionar produto"
              value={productQuery}
              onChange={(event) => setProductQuery(event.target.value)}
            />
            {productQuery.trim().length >= 2 && (
              <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-border bg-popover shadow-lg">
                {findingProducts && <p className="p-3 text-xs text-muted-foreground">Buscando…</p>}
                {!findingProducts && (products ?? []).length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground">Nenhum produto encontrado.</p>
                )}
                {(products ?? []).map((product: any) => (
                  <button
                    key={product.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => addProduct(product)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{product.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[product.internal_code, product.manufacturer_code, product.sku].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className="block font-bold">{brl(product.price)}</span>
                      <span className="text-muted-foreground">{product.available} em estoque</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {form.items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhum item ainda. Use a busca acima para montar o orçamento.
            </p>
          ) : (
            <div className="space-y-3">
              {form.items.map((item, index) => (
                <div key={`${item.product_id ?? "livre"}-${index}`} className="rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.sku ?? "item livre"}
                        {typeof item.available === "number" ? ` · ${item.available} em estoque` : ""}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeItem(index)} aria-label="Remover item">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <div>
                      <Label>Quantidade</Label>
                      <Input
                        type="number"
                        min={1}
                        step="1"
                        value={item.qty}
                        onChange={(e) => updateItem(index, { qty: Math.max(Number(e.target.value) || 0, 0) })}
                      />
                    </div>
                    <div>
                      <Label>Preço unitário</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => updateItem(index, { unit_price: Math.max(Number(e.target.value) || 0, 0) })}
                      />
                    </div>
                    <div>
                      <Label>Desconto (R$)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.discount}
                        onChange={(e) => updateItem(index, { discount: Math.max(Number(e.target.value) || 0, 0) })}
                      />
                    </div>
                    <div>
                      <Label>Observação</Label>
                      <Input
                        value={item.notes ?? ""}
                        onChange={(e) => updateItem(index, { notes: e.target.value || null })}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-right text-sm font-bold">
                    {brl(item.qty * item.unit_price - (item.discount || 0))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Condições comerciais" description="Texto comercial. Nenhuma cobrança é gerada aqui.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="q-discount">Desconto geral (R$)</Label>
              <Input
                id="q-discount"
                type="number"
                min={0}
                step="0.01"
                value={form.discount}
                onChange={(e) => set("discount", Math.max(Number(e.target.value) || 0, 0))}
              />
            </div>
            <div>
              <Label htmlFor="q-shipping">Frete estimado (R$)</Label>
              <Input
                id="q-shipping"
                type="number"
                min={0}
                step="0.01"
                value={form.shipping_amount}
                onChange={(e) => set("shipping_amount", Math.max(Number(e.target.value) || 0, 0))}
              />
            </div>
            <div>
              <Label htmlFor="q-valid">Validade</Label>
              <Input id="q-valid" type="date" value={form.valid_until} onChange={(e) => set("valid_until", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="q-follow">Próximo acompanhamento</Label>
              <Input id="q-follow" type="date" value={form.follow_up_at} onChange={(e) => set("follow_up_at", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="q-payment">Condições de pagamento</Label>
              <Input
                id="q-payment"
                value={form.payment_terms}
                onChange={(e) => set("payment_terms", e.target.value)}
                placeholder="Ex.: 30/60 dias, boleto"
              />
            </div>
            <div>
              <Label htmlFor="q-delivery">Prazo / condição de entrega</Label>
              <Input
                id="q-delivery"
                value={form.delivery_terms}
                onChange={(e) => set("delivery_terms", e.target.value)}
                placeholder="Ex.: retirada em 2 dias úteis"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="q-cnotes">Observações ao cliente</Label>
              <Textarea
                id="q-cnotes"
                rows={3}
                value={form.customer_notes}
                onChange={(e) => set("customer_notes", e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="q-inotes">Observações internas</Label>
              <Textarea
                id="q-inotes"
                rows={3}
                value={form.internal_notes}
                onChange={(e) => set("internal_notes", e.target.value)}
              />
            </div>
          </div>
        </SectionCard>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-display text-base font-bold">Resumo</h2>
          {status && (
            <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ${statusTone(status)}`}>
              {statusLabel(status)}
            </span>
          )}
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Itens</dt><dd>{brl(totals.gross)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Desconto nos itens</dt><dd>-{brl(totals.itemsDiscount)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd>{brl(totals.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Desconto geral</dt><dd>-{brl(form.discount || 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Frete</dt><dd>{brl(form.shipping_amount || 0)}</dd></div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
              <dt>Total</dt><dd>{brl(totals.total)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Validade: {form.valid_until ? new Date(`${form.valid_until}T00:00:00`).toLocaleDateString("pt-BR") : "não definida"}
          </p>
          {stockAlert.length > 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Quantidade acima do estoque disponível em {stockAlert.length} item(ns).
            </p>
          )}
          <div className="mt-4 space-y-2">
            <Button className="w-full" onClick={() => save(false)} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => save(true)}
              disabled={saving || generating || form.items.length === 0}
            >
              <FileCheck2 className="mr-2 h-4 w-4" /> Salvar e gerar proposta
            </Button>
            {form.items.length === 0 && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Plus className="h-3 w-3" /> Adicione itens para gerar a proposta.
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
