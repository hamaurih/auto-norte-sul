import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { brl } from "@/lib/format";
import { toast } from "sonner";
import { searchProductsForAssist, createAssistOrder } from "@/lib/vendedor.functions";
import { maskPhone, maskDocument } from "@/lib/format-input";
import { getB2BPriceContext, getMyCommercialSettings } from "@/lib/commercial.functions";

export const Route = createFileRoute("/_authenticated/vendedor/pedido-assistido")({
  head: () => ({ meta: [{ title: "Pedido assistido · Vendedor" }] }),
  component: PedidoAssistido,
});

interface Item { product_id: string; sku: string; name: string; price: number; qty: number }

function PedidoAssistido() {
  const [search, setSearch]  = useState("");
  const [items, setItems]    = useState<Item[]>([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [lead, setLead]      = useState({
    lead_name: "", lead_email: "", lead_phone: "", lead_cnpj: "", notes: "",
  });

  const commercialQuery = useQuery({
    queryKey: ["my-commercial-settings"],
    queryFn: () => getMyCommercialSettings(),
    staleTime: 300_000,
  });
  const cnpjDigits = lead.lead_cnpj.replace(/\D/g, "");
  const priceContextQuery = useQuery({
    queryKey: ["assist-price-context", cnpjDigits],
    enabled: cnpjDigits.length === 14,
    queryFn: () => getB2BPriceContext({ data: { cnpj: cnpjDigits } }),
    staleTime: 60_000,
  });

  // SEC-04: usa server function com autenticação e filtro de tenant
  const { data: results = [], isFetching } = useQuery({
    queryKey: ["asst-search", search],
    enabled:  search.length >= 2,
    queryFn:  () => searchProductsForAssist({ data: { q: search, limit: 10 } }),
  });

  const save = useMutation({
    mutationFn: (status: "rascunho" | "enviado") =>
      createAssistOrder({
        data: { ...lead, items, discount_pct: discountPct, status },
      }),
    onSuccess: (_, status) => {
      toast.success(status === "enviado" ? "Pedido enviado" : "Rascunho salvo");
      setItems([]);
      setLead({ lead_name: "", lead_email: "", lead_phone: "", lead_cnpj: "", notes: "" });
      setDiscountPct(0);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const addItem = useCallback((p: any) => {
    const tableDiscountPct = Number(priceContextQuery.data?.discountPct ?? 0);
    const basePrice = Number(p.price_b2b ?? p.price_b2c ?? 0);
    const price = Number((basePrice * (1 - tableDiscountPct / 100) * (1 - discountPct / 100)).toFixed(2));
    setItems((prev) => {
      const found = prev.find((i) => i.product_id === p.id);
      if (found) return prev.map((i) => i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product_id: p.id, sku: p.sku, name: p.name, price, qty: 1 }];
    });
  }, [discountPct, priceContextQuery.data?.discountPct]);

  const removeItem = (product_id: string) =>
    setItems((prev) => prev.filter((i) => i.product_id !== product_id));

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);

  return (
    <div className="p-4 space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase">Pedido assistido</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Preços recalculados no servidor pela tabela do CNPJ informado.
          </p>
        </div>
        {commercialQuery.data?.isSalesRep && (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
            Limite de desconto adicional: {Number(commercialQuery.data.maxDiscountPct).toFixed(2)}%
          </span>
        )}
      </div>

      {/* Dados do lead */}
      <fieldset className="rounded-lg border border-border bg-card p-4 space-y-3">
        <legend className="px-2 text-sm font-bold uppercase">Cliente / Lead</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Fld label="Nome">
            <input value={lead.lead_name} onChange={(e) => setLead((l) => ({ ...l, lead_name: e.target.value }))} className={inp} />
          </Fld>
          <Fld label="Email">
            <input type="email" value={lead.lead_email} onChange={(e) => setLead((l) => ({ ...l, lead_email: e.target.value }))} className={inp} />
          </Fld>
          <Fld label="WhatsApp">
            <input value={lead.lead_phone} onChange={(e) => setLead((l) => ({ ...l, lead_phone: maskPhone(e.target.value) }))} className={inp} placeholder="(00) 00000-0000" />
          </Fld>
          <Fld label="CPF / CNPJ">
            <input value={lead.lead_cnpj} onChange={(e) => setLead((l) => ({ ...l, lead_cnpj: maskDocument(e.target.value) }))} className={inp} placeholder="000.000.000-00" />
          </Fld>
          <div className="sm:col-span-2">
            <Fld label="Observações">
              <textarea value={lead.notes} rows={2} onChange={(e) => setLead((l) => ({ ...l, notes: e.target.value }))} className={inp} />
            </Fld>
          </div>
        </div>
      </fieldset>

      {/* Busca de produtos */}
      <fieldset className="rounded-lg border border-border bg-card p-4 space-y-3">
        <legend className="px-2 text-sm font-bold uppercase">Adicionar produto</legend>
        <div className="flex flex-wrap items-end gap-3 rounded-md bg-muted/50 p-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">Desconto adicional (%)</span>
            <input
              type="number"
              min={0}
              max={commercialQuery.data?.maxDiscountPct ?? 0}
              step="0.01"
              value={discountPct}
              onChange={(e) => setDiscountPct(Math.max(0, Number(e.target.value) || 0))}
              className="w-36 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <span className="pb-2 text-xs text-muted-foreground">
            Além do desconto automático da tabela B2B.
          </span>
        </div>
        {priceContextQuery.data && (
          <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
            CNPJ reconhecido: Tabela {priceContextQuery.data.priceTable} · {priceContextQuery.data.discountPct.toFixed(2)}% automático
          </p>
        )}
        {cnpjDigits.length > 0 && cnpjDigits.length !== 14 && (
          <p className="text-xs text-hot">Digite um CNPJ completo para aplicar a tabela vinculada.</p>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nome ou SKU…"
          className={inp}
        />
        {isFetching && <p className="text-xs text-muted-foreground">Buscando…</p>}
        {results.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {results.map((p: any) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate">{p.sku} — {p.name}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">Est: {p.stock}</span>
                  <span className="font-semibold">
                    {brl(Number(((p.price_b2b ?? p.price_b2c ?? 0) * (1 - Number(priceContextQuery.data?.discountPct ?? 0) / 100) * (1 - discountPct / 100)).toFixed(2)))}
                  </span>
                  <button
                    type="button"
                    onClick={() => addItem(p)}
                    disabled={p.stock === 0}
                    className="rounded bg-primary px-2 py-1 text-xs font-bold text-primary-foreground disabled:opacity-40"
                  >
                    + Add
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {/* Itens adicionados */}
      {items.length > 0 && (
        <fieldset className="rounded-lg border border-border bg-card p-4 space-y-3">
          <legend className="px-2 text-sm font-bold uppercase">Itens do pedido</legend>
          <ul className="divide-y divide-border text-sm">
            {items.map((i) => (
              <li key={i.product_id} className="flex items-center gap-2 py-2">
                <span className="flex-1 truncate">{i.qty}× {i.name}</span>
                <span className="font-semibold">{brl(i.price * i.qty)}</span>
                <button type="button" onClick={() => removeItem(i.product_id)} className="text-destructive text-xs hover:underline">remover</button>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-border pt-2 font-semibold">
            <span>Total</span>
            <span>{brl(subtotal)}</span>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              disabled={save.isPending || items.length === 0}
              onClick={() => save.mutate("rascunho")}
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm font-bold hover:bg-muted disabled:opacity-40"
            >
              {save.isPending ? "Salvando…" : "Salvar rascunho"}
            </button>
            <button
              type="button"
              disabled={save.isPending || items.length === 0}
              onClick={() => save.mutate("enviado")}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:brightness-110 disabled:opacity-40"
            >
              {save.isPending ? "Enviando…" : "Enviar pedido"}
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}

const inp = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
