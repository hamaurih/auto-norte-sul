import { createFileRoute, Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useCart, cartStore } from "@/lib/cart-store";
import { brl, installments } from "@/lib/format";

export const Route = createFileRoute("/carrinho")({
  head: () => ({ meta: [{ title: "Carrinho · Norte Sul" }] }),
  component: CartPage,
});

function CartPage() {
  const { items, subtotal } = useCart();

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
                  <span className="price-tag text-lg">{brl(i.unitPrice * i.quantity)}</span>
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
            <span>{brl(subtotal)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Frete</span>
            <span>calculado no checkout</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold">Total</span>
            <span className="price-tag text-2xl">{brl(subtotal)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{installments(subtotal, 10)}</p>
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
