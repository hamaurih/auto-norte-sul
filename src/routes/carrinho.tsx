import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { useCart, cartStore } from "@/lib/cart-store";
import { brl, installments } from "@/lib/format";
import { useSession } from "@/lib/session";
import { getMyB2BCommercialProfile, getMyB2BPrices } from "@/lib/b2b.functions";

export const Route = createFileRoute("/carrinho")({
  head: () => ({ meta: [{ title: "Carrinho · Norte Sul" }] }),
  component: CartPage,
});

function CartPage() {
  const { items, subtotal } = useCart();
  const { user, isB2BApproved } = useSession();
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
      <h1 className="mb-4 font-display text-3xl font-bold uppercase">Carrinho</h1>
      {commercialProfile?.approved && (
        <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
          <b>Condição B2B ativa · Tabela {commercialProfile.priceTable ?? "C"}</b>
          <span className="ml-2 text-muted-foreground">Os valores abaixo já usam sua condição comercial.</span>
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-2">
          {items.map((i) => (
            <div key={i.productId} className="flex gap-3 rounded-lg border border-border bg-card p-3">
              {i.imageUrl && <img src={i.imageUrl} alt={i.name} className="h-24 w-24 rounded object-cover" />}
              <div className="flex flex-1 flex-col">
                <Link to="/produto/$slug" params={{ slug: i.slug }} className="line-clamp-2 text-sm font-semibold hover:text-primary">
                  {i.name}
                </Link>
                <span className="text-xs text-muted-foreground">SKU {i.sku}</span>
                <div className="mt-auto flex items-center justify-between">
                  <div className="flex items-center rounded-md border border-border">
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

        <aside className="h-fit rounded-lg border border-border bg-card p-4">
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
            className="mt-4 block rounded-md bg-primary px-4 py-3 text-center text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110"
          >
            Finalizar compra
          </Link>
          <Link to="/catalogo" className="mt-2 block text-center text-xs text-muted-foreground hover:text-primary">
            Continuar comprando
          </Link>
        </aside>
      </div>
    </div>
  );
}
