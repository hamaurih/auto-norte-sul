import { Link } from "@tanstack/react-router";
import { ShoppingCart, Zap, Car } from "lucide-react";
import { brl } from "@/lib/format";
import { cartStore } from "@/lib/cart-store";
import { displayPrice, primaryImage, type ProductRow } from "@/lib/queries";
import { toast } from "sonner";

export function ProductCard({ p, isB2B }: { p: ProductRow; isB2B: boolean }) {
  const img = primaryImage(p);
  const price = displayPrice(p, isB2B);
  const off =
    price.compare && price.compare > price.effective
      ? Math.round(((price.compare - price.effective) / price.compare) * 100)
      : null;

  return (
    <div className="group flex w-[180px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-lg sm:w-[220px]">
      <Link
        to="/produto/$slug"
        params={{ slug: p.slug }}
        className="relative block aspect-square overflow-hidden bg-muted"
      >
        {img ? (
          <img
            src={img}
            alt={p.name}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted via-muted to-secondary/10 text-muted-foreground">
            <Car className="h-10 w-10 opacity-40" />
            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
              Norte Sul
            </span>
          </div>
        )}
        {off && (
          <span className="absolute left-2 top-2 rounded bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
            -{off}%
          </span>
        )}
        {p.is_new && (
          <span className="absolute right-2 top-2 rounded bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-secondary-foreground">
            Novo
          </span>
        )}
        {p.stock === 0 && (
          <span className="absolute bottom-2 left-2 rounded bg-muted-foreground/90 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
            Sem estoque
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {p.brand && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {p.brand.name}
          </span>
        )}
        <Link
          to="/produto/$slug"
          params={{ slug: p.slug }}
          className="line-clamp-2 text-sm font-medium leading-tight text-foreground hover:text-primary"
        >
          {p.name}
        </Link>
        <span className="text-[10px] text-muted-foreground">SKU {p.sku}</span>

        <div className="mt-auto pt-2">
          {price.compare && price.compare > price.effective && (
            <span className="block text-xs text-muted-foreground line-through">
              {brl(price.compare)}
            </span>
          )}
          <span className="price-tag text-lg leading-none">{brl(price.effective)}</span>
          {price.wholesale && (
            <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-success">
              <Zap className="h-3 w-3" /> Atacado
            </span>
          )}
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            10x de {brl(price.effective / 10)}
          </span>
        </div>

        <button
          disabled={p.stock === 0}
          onClick={() => {
            cartStore.add({
              productId: p.id,
              sku: p.sku,
              name: p.name,
              slug: p.slug,
              imageUrl: img,
              unitPrice: price.effective,
            });
            toast.success("Adicionado ao carrinho");
          }}
          className="mt-2 inline-flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShoppingCart className="h-3.5 w-3.5" /> Comprar
        </button>
      </div>
    </div>
  );
}
