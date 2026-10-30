import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { CreditCard, FileText, ShieldCheck, Trash2, Truck } from "lucide-react";
import { useCart, cartStore } from "@/lib/cart-store";
import { brl, installments } from "@/lib/format";
import { useSession } from "@/lib/session";
import { getMyB2BCommercialProfile, getMyB2BPrices } from "@/lib/b2b.functions";
import { createMyQuoteFromCart } from "@/lib/my-quotes.functions";


export const Route = createFileRoute("/carrinho")({
  head: () => ({ meta: [{ title: "Carrinho · Norte Sul" }] }),
  component: CartPage,
});

function CartPage() {
  const { items, subtotal } = useCart();
  const { user, isB2BApproved } = useSession();
  const navigate = useNavigate();
  const saveQuote = useServerFn(createMyQuoteFromCart);
  const [savingQuote, setSavingQuote] = useState(false);
  const quoteAttempt = useRef<{ key: string; fingerprint: string } | null>(null);

  async function generateQuote() {
    if (!user) {
      navigate({ to: "/orcamento" });
      return;
    }
    if (!items.length || savingQuote) return;
    setSavingQuote(true);
    const productItems = items.map((item) => ({ product_id: item.productId, quantity: item.quantity }));
    const fingerprint = JSON.stringify(productItems);
    if (quoteAttempt.current?.fingerprint !== fingerprint) {
      quoteAttempt.current = { key: crypto.randomUUID(), fingerprint };
    }
    try {
      const result = await saveQuote({ data: { items: productItems, requestKey: quoteAttempt.current.key } });
      quoteAttempt.current = null;
      toast.success("Orçamento #" + result.number + " criado. Você já pode transformá-lo em compra.");
      navigate({ to: "/orcamentos" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o orçamento.");
    } finally {
      setSavingQuote(false);
    }
  }
  const loadB2BPrices = useServerFn(getMyB2BPrices);
  const loadCommercialProfile = useServerFn(getMyB2BCommercialProfile);
  const productIds = items.map((item) => item.productId);
  const { data: b2bPriceData } = useQuery({
    queryKey: ["cart-b2b-prices", productIds],
    queryFn: () => loadB2BPrices({ data: { productIds } }),
    enabled: Boolean(user && isB2BApproved && productIds.length),
    staleTime: 60_000,
  });
  const { data: commercialProfile } = useQuery({
    queryKey: ["cart-b2b-commercial-profile", user?.id],
    queryFn: () => loadCommercialProfile(),
    enabled: Boolean(user && isB2BApproved),
    staleTime: 60_000,
  });
  const effectiveSubtotal = isB2BApproved
    ? items.reduce(
        (sum, item) =>
          sum + (b2bPriceData?.prices?.[item.productId]?.effective ?? item.unitPrice) * item.quantity,
        0,
      )
    : subtotal;
  const maxInstallments = commercialProfile?.approved
    ? commercialProfile.maxCardInstallments
    : 6;

  if (items.length === 0) {
    return (
      <div className="container-x py-16 text-center">
        <h1 className="font-display text-3xl font-bold uppercase">Seu carrinho está vazio</h1>
        <p className="mt-2 text-sm text-muted-foreground">Adicione produtos para começar.</p>
        <Link to="/catalogo" className="mt-4 inline-block rounded-md bg-primary px-6 py-3 text-sm font-bold uppercase text-primary-foreground">
          Ver catálogo
        </Link>
      </div>
    );
  }

  return (
    <div className="container-x py-6">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Seu pedido</p>
        <h1 className="mt-1 font-display text-3xl font-bold uppercase">Carrinho</h1>
        <p className="mt-1 text-sm text-muted-foreground">Confira quantidades e valores antes de seguir para entrega e pagamento.</p>
      </div>
      {commercialProfile?.approved && (
        <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
          <b>Condição B2B ativa · Tabela {commercialProfile.priceTable ?? "C"}</b>
          <span className="ml-2 text-muted-foreground">Os valores abaixo já usam sua condição comercial.</span>
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-2">
          {items.map((i) => (
            <div key={i.productId} className="flex gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
              {i.imageUrl && <img src={i.imageUrl} alt={i.name} className="h-24 w-24 rounded object-cover" />}
              <div className="flex flex-1 flex-col">
                <Link to="/produto/$slug" params={{ slug: i.slug }} className="line-clamp-2 text-sm font-semibold hover:text-primary">
                  {i.name}
                </Link>
                <span className="text-xs text-muted-foreground">SKU {i.sku}</span>
                <div className="mt-auto flex items-center justify-between">
                  <div className="flex items-center rounded-lg border border-border bg-background">
                    <button className="px-2 py-1" onClick={() => cartStore.setQty(i.productId, i.quantity - 1)}>−</button>
                    <span className="w-8 text-center text-sm">{i.quantity}</span>
                    <button className="px-2 py-1" onClick={() => cartStore.setQty(i.productId, i.quantity + 1)}>+</button>
                  </div>
                  <span className="price-tag text-lg">
                    {brl((b2bPriceData?.prices?.[i.productId]?.effective ?? i.unitPrice) * i.quantity)}
                  </span>
                  <button onClick={() => cartStore.remove(i.productId)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <aside className="h-fit rounded-2xl border border-border bg-card p-5 shadow-sm md:sticky md:top-24">
          <h3 className="mb-3 font-display text-lg font-bold uppercase">Resumo</h3>
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span>{brl(effectiveSubtotal)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Frete</span>
            <span>calculado no checkout</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold">Total</span>
            <span className="price-tag text-2xl">{brl(effectiveSubtotal)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{installments(effectiveSubtotal, maxInstallments)} sem juros</p>
          <Link
            to="/checkout"
            className="mt-4 block rounded-xl bg-primary px-4 py-3.5 text-center text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110"
          >
            Ir para o checkout
          </Link>
          <button
            type="button"
            disabled={savingQuote}
            onClick={generateQuote}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-primary px-4 py-3 text-sm font-bold text-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            {savingQuote ? "Gerando orçamento…" : user ? "Gerar orçamento sem aprovação" : "Visualizar orçamento"}
          </button>
          {user && (
            <Link to="/orcamentos" className="mt-2 block text-center text-xs font-semibold text-primary">
              Meus orçamentos
            </Link>
          )}
          <div className="mt-4 grid gap-2 border-t border-border pt-4 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Preço e estoque validados no servidor</div>
            <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-primary" /> PIX, cartão e boleto conforme seu cadastro</div>
            <div className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" /> Entrega ou retirada escolhidas no checkout</div>
          </div>
          <Link to="/catalogo" className="mt-2 block text-center text-xs text-muted-foreground hover:text-primary">
            Continuar comprando
          </Link>
        </aside>
      </div>
    </div>
  );
}
