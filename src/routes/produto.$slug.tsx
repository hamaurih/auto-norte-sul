import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ShoppingCart, MessageCircle, Truck, Shield, Package } from "lucide-react";
import { fetchProductApplications, fetchProductBySlug, fetchRelated, displayPrice, primaryImage } from "@/lib/queries";
import { brl, installments } from "@/lib/format";
import { cartStore } from "@/lib/cart-store";
import { useSession } from "@/lib/session";
import { ProductCard } from "@/components/site/ProductCard";
import { toast } from "sonner";

export const Route = createFileRoute("/produto/$slug")({
  loader: async ({ params }) => {
    const p = await fetchProductBySlug(params.slug);
    if (!p) throw notFound();
    return { product: p };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.product.name} · Norte Sul` },
          { name: "description", content: loaderData.product.short_description ?? loaderData.product.name },
          { property: "og:title", content: loaderData.product.name },
          { property: "og:image", content: primaryImage(loaderData.product) ?? "" },
        ]
      : [{ title: "Produto" }],
  }),
  component: ProductPage,
  notFoundComponent: () => (
    <div className="container-x py-20 text-center">
      <h1 className="font-display text-3xl font-bold uppercase">Produto não encontrado</h1>
      <Link to="/catalogo" className="mt-4 inline-block text-primary underline">Voltar ao catálogo</Link>
    </div>
  ),
});

function ProductPage() {
  const { product } = Route.useLoaderData();
  const { isB2BApproved } = useSession();
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);

  const { data: apps = [] } = useQuery({
    queryKey: ["apps", product.id],
    queryFn: () => fetchProductApplications(product.id),
  });
  const { data: related = [] } = useQuery({
    queryKey: ["related", product.category?.slug, product.id],
    queryFn: () => fetchRelated(product.category?.slug ?? null, product.id),
  });

  const price = displayPrice(product, isB2BApproved);
  const images = (product.images ?? []).slice().sort((a: { is_primary: boolean }, b: { is_primary: boolean }) => Number(b.is_primary) - Number(a.is_primary));
  const currentImg = images[imgIdx]?.url ?? primaryImage(product);
  const inStock = product.stock > 0;
  const waMsg = encodeURIComponent(`Olá, tenho dúvidas sobre ${product.name} (SKU ${product.sku})`);

  return (
    <div className="container-x py-6">
      <nav className="mb-3 text-xs text-muted-foreground">
        <Link to="/" className="hover:text-primary">Home</Link> ·{" "}
        <Link to="/catalogo" className="hover:text-primary">Catálogo</Link>
        {product.category && (
          <> · <Link to="/catalogo" search={{ category: product.category.slug } as never} className="hover:text-primary">{product.category.name}</Link></>
        )}
      </nav>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_360px] lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Gallery */}
        <div className="grid gap-3 sm:grid-cols-[80px_1fr]">
          <div className="order-2 flex gap-2 sm:order-1 sm:flex-col">
            {images.map((im: { url: string }, i: number) => (
              <button
                key={im.url}
                onClick={() => setImgIdx(i)}
                className={`h-16 w-16 overflow-hidden rounded border-2 ${i === imgIdx ? "border-primary" : "border-border"}`}
              >
                <img src={im.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
          <div className="order-1 aspect-square overflow-hidden rounded-lg border border-border bg-muted sm:order-2">
            {currentImg && <img src={currentImg} alt={product.name} className="h-full w-full object-contain" />}
          </div>
        </div>

        {/* Info */}
        <div>
          {product.brand && (
            <Link to="/catalogo" search={{ brand: product.brand.slug } as never} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-primary">
              {product.brand.name}
            </Link>
          )}
          <h1 className="mt-1 font-display text-2xl font-bold leading-tight md:text-3xl">{product.name}</h1>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>SKU {product.sku}</span>
            {product.category && <span>· {product.category.name}</span>}
          </div>

          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            {price.compare && price.compare > price.effective && (
              <span className="block text-xs text-muted-foreground line-through">De {brl(price.compare)}</span>
            )}
            <div className="flex items-baseline gap-2">
              <span className="price-tag text-4xl">{brl(price.effective)}</span>
              {price.wholesale && (
                <span className="rounded bg-success px-2 py-0.5 text-[10px] font-bold uppercase text-success-foreground">Atacado</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{installments(price.effective, 10)}</p>
            {!isB2BApproved && product.price_b2b && (
              <div className="mt-2 rounded border border-dashed border-primary/40 bg-primary/5 p-2 text-xs">
                <b>Você é lojista?</b>{" "}
                <Link to="/b2b" className="text-primary underline">Cadastre-se</Link> e desbloqueie a tabela atacado.
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 text-sm">
              <Package className="h-4 w-4 text-success" />
              {inStock ? (
                <span className="font-semibold text-success">Em estoque · {product.stock} unid.</span>
              ) : (
                <span className="font-semibold text-destructive">Indisponível</span>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <div className="flex items-center rounded-md border border-border">
                <button className="px-3 py-1.5" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <input value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-12 bg-transparent py-1.5 text-center text-sm outline-none" />
                <button className="px-3 py-1.5" onClick={() => setQty((q) => Math.min(product.stock || 99, q + 1))}>+</button>
              </div>
              <button
                disabled={!inStock}
                onClick={() => {
                  cartStore.add({
                    productId: product.id,
                    sku: product.sku,
                    name: product.name,
                    slug: product.slug,
                    imageUrl: currentImg,
                    unitPrice: price.effective,
                  }, qty);
                  toast.success("Adicionado ao carrinho");
                }}
                className="flex-1 rounded-md bg-primary px-4 py-3 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110 disabled:opacity-40"
              >
                <ShoppingCart className="mr-1 inline h-4 w-4" /> Adicionar ao carrinho
              </button>
            </div>

            <a
              href={`https://wa.me/5500000000000?text=${waMsg}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-success bg-success/10 px-4 py-2.5 text-sm font-bold text-success hover:bg-success/20"
            >
              <MessageCircle className="h-4 w-4" /> Tirar dúvida no WhatsApp
            </a>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 rounded bg-muted p-2"><Truck className="h-4 w-4 text-primary" /> Frete p/ todo Brasil</div>
              <div className="flex items-center gap-2 rounded bg-muted p-2"><Shield className="h-4 w-4 text-primary" /> Garantia oficial</div>
            </div>
          </div>
        </div>
      </div>

      {/* Description + Applications */}
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 font-display text-xl font-bold uppercase">Descrição</h2>
          <p className="whitespace-pre-line text-sm text-foreground/80">
            {product.description ?? product.short_description ?? "Sem descrição disponível."}
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-display text-xl font-bold uppercase">Aplicação / Compatibilidade</h2>
          {apps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Compatibilidade universal ou não cadastrada.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {apps.map((a, i) => (
                <li key={i} className="rounded bg-muted px-3 py-2">
                  <b>{a.vehicle_make} {a.vehicle_model}</b>
                  {a.year_from && a.year_to && <> · {a.year_from}–{a.year_to}</>}
                  
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-display text-2xl font-bold uppercase">Produtos relacionados</h2>
          <div className="scroll-rail">
            {related.map((p) => (
              <ProductCard key={p.id} p={p} isB2B={isB2BApproved} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
