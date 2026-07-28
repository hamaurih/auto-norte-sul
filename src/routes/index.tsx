import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Truck,
  ShieldCheck,
  Percent,
  CreditCard,
  MessageCircle,
  Handshake,
  Users,
  Package,
  Zap,
  Sparkles,
  Lightbulb,
  Volume2,
  Wrench,
  Car,
  Gauge,
  Sofa,
  Disc3,
} from "lucide-react";
import { HeroCarousel, Rail } from "@/components/site/HeroCarousel";
import { ProductCard } from "@/components/site/ProductCard";
import {
  fetchBanners,
  fetchBrands,
  fetchCategories,
  fetchFeatured,
  fetchMiniBanners,
  fetchNewArrivals,
  fetchOffers,
  fetchBestSellers,
} from "@/lib/queries";
import { useSession } from "@/lib/session";

const HOME_QUERIES: { queryKey: readonly string[]; queryFn: () => Promise<unknown> }[] = [
  { queryKey: ["banners"], queryFn: fetchBanners },
  { queryKey: ["mini-banners"], queryFn: fetchMiniBanners },
  { queryKey: ["categories"], queryFn: fetchCategories },
  { queryKey: ["offers"], queryFn: fetchOffers },
  { queryKey: ["new"], queryFn: fetchNewArrivals },
  { queryKey: ["best"], queryFn: fetchBestSellers },
  { queryKey: ["featured"], queryFn: fetchFeatured },
  { queryKey: ["brands"], queryFn: fetchBrands },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Norte Sul Acessórios · Loja e Atacado Automotivo" },
      {
        name: "description",
        content:
          "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores.",
      },
    ],
  }),
  loader: ({ context }) => {
    // Fire-and-forget prefetch: primes the cache but never blocks the route
    // from rendering. If a single Supabase query is slow the page still
    // paints and individual sections resolve independently on the client.
    for (const q of HOME_QUERIES) {
      void context.queryClient.prefetchQuery({
        queryKey: [...q.queryKey],
        queryFn: q.queryFn,
        staleTime: 60_000,
      });
    }
  },
  component: Home,
});

/* ------------------------------------------------------------------ */
/*  Ícones por categoria (fallback quando não há imagem cadastrada)   */
/* ------------------------------------------------------------------ */
const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  som: Volume2,
  "som-automotivo": Volume2,
  audio: Volume2,
  iluminacao: Lightbulb,
  led: Lightbulb,
  rodas: Disc3,
  pneus: Disc3,
  "rodas-e-pneus": Disc3,
  seguranca: ShieldCheck,
  alarme: ShieldCheck,
  alarmes: ShieldCheck,
  performance: Gauge,
  multimidia: Sparkles,
  estetica: Sparkles,
  "estetica-automotiva": Sparkles,
  acessorios: Sofa,
  "acessorios-internos": Sofa,
};
function iconForCategory(slug: string) {
  const key = slug.toLowerCase();
  for (const k of Object.keys(CATEGORY_ICONS)) if (key.includes(k)) return CATEGORY_ICONS[k];
  return Car;
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                          */
/* ------------------------------------------------------------------ */
function RailSkeleton() {
  return (
    <div className="scroll-rail">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="w-[180px] shrink-0 overflow-hidden rounded-lg border border-border bg-card sm:w-[220px]"
        >
          <div className="aspect-square animate-pulse bg-muted" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-6 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function HomeFallback() {
  return (
    <div>
      <div className="pt-4">
        <section className="container-x">
          <div className="aspect-[21/9] w-full animate-pulse rounded-lg bg-muted md:aspect-[16/6]" />
        </section>
      </div>
      <section className="container-x mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {["Frete Brasil", "10x sem juros", "PIX 5% OFF", "Compra segura"].map((label) => (
          <div key={label} className="h-10 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </section>
      <section className="container-x mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-[16/10] animate-pulse rounded-xl bg-muted" />
        ))}
      </section>
      <SectionShell title="Lançamentos" subtitle="Chegou primeiro na Norte Sul">
        <RailSkeleton />
      </SectionShell>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Home() {
  const { isB2BApproved } = useSession();
  const common = { staleTime: 60_000, retry: 1 } as const;
  const { data: banners = [], isLoading: loadingBanners, isError: errorBanners } = useQuery({
    queryKey: ["banners"],
    queryFn: fetchBanners,
    ...common,
  });
  const { data: miniBanners = [] } = useQuery({
    queryKey: ["mini-banners"],
    queryFn: fetchMiniBanners,
    ...common,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
    ...common,
  });
  const { data: offers = [], isLoading: loadingOffers } = useQuery({
    queryKey: ["offers"],
    queryFn: fetchOffers,
    ...common,
  });
  const { data: news = [], isLoading: loadingNews } = useQuery({
    queryKey: ["new"],
    queryFn: fetchNewArrivals,
    ...common,
  });
  const { data: best = [], isLoading: loadingBest } = useQuery({
    queryKey: ["best"],
    queryFn: fetchBestSellers,
    ...common,
  });
  const { data: featured = [], isLoading: loadingFeatured } = useQuery({
    queryKey: ["featured"],
    queryFn: fetchFeatured,
    ...common,
  });
  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: fetchBrands,
    ...common,
  });

  const heroBanners = banners.map((b) => ({
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    image_url: b.image_url,
    link_url: b.link_url,
    cta_label: b.cta_label,
  }));

  return (
    <div>
      {/* ============ HERO ============ */}
      <div className="pt-4">
        {heroBanners.length > 0 ? (
          <HeroCarousel banners={heroBanners} />
        ) : loadingBanners && !errorBanners ? (
          <section className="container-x">
            <div className="aspect-[21/9] w-full animate-pulse rounded-lg bg-muted md:aspect-[16/6]" />
          </section>
        ) : (
          <FallbackHero />
        )}
      </div>

      {/* ============ TRUST STRIP ============ */}
      <section className="container-x mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { icon: Truck, label: "Frete Brasil" },
          { icon: CreditCard, label: "10x sem juros" },
          { icon: Percent, label: "PIX 5% OFF" },
          { icon: ShieldCheck, label: "Compra segura" },
        ].map(({ icon: Icon, label }) => (
          <div
            key={label}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold"
          >
            <Icon className="h-4 w-4 text-primary" /> {label}
          </div>
        ))}
      </section>

      {/* ============ MINI BANNERS ============ */}
      <MiniBannersGrid banners={miniBanners} />

      {/* ============ DEPARTAMENTOS ============ */}
      {categories.length > 0 && (
        <section className="container-x mt-10">
          <SectionHeader title="Departamentos" subtitle="Escolha a categoria e monte seu carro" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8">
            {categories.map((c) => {
              const Icon = iconForCategory(c.slug);
              return (
                <Link
                  key={c.id}
                  to="/catalogo"
                  search={{ category: c.slug } as never}
                  className="group flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-4 text-center transition hover:-translate-y-0.5 hover:border-primary hover:shadow-[var(--shadow-brand)]"
                >
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className="text-xs font-semibold uppercase leading-tight">{c.name}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ============ OFERTAS DO DIA ============ */}
      {loadingOffers ? (
        <SectionShell title="Ofertas do dia" subtitle="Descontos que não voltam">
          <RailSkeleton />
        </SectionShell>
      ) : offers.length > 0 ? (
        <Rail title="Ofertas do dia" subtitle="Descontos que não voltam" viewAllHref="/catalogo">
          {offers.map((p) => (
            <ProductCard key={p.id} p={p} isB2B={isB2BApproved} />
          ))}
        </Rail>
      ) : null}

      {/* ============ LANÇAMENTOS ============ */}
      {loadingNews ? (
        <SectionShell title="Lançamentos" subtitle="Chegou primeiro na Norte Sul">
          <RailSkeleton />
        </SectionShell>
      ) : news.length > 0 ? (
        <Rail title="Lançamentos" subtitle="Chegou primeiro na Norte Sul" viewAllHref="/catalogo">
          {news.map((p) => (
            <ProductCard key={p.id} p={p} isB2B={isB2BApproved} />
          ))}
        </Rail>
      ) : null}

      {/* ============ BLOCO B2B ============ */}
      <B2BBlock />

      {/* ============ MAIS VENDIDOS ============ */}
      {loadingBest ? (
        <SectionShell title="Mais vendidos" subtitle="Escolhidos por quem entende">
          <RailSkeleton />
        </SectionShell>
      ) : best.length > 0 ? (
        <Rail title="Mais vendidos" subtitle="Escolhidos por quem entende" viewAllHref="/catalogo">
          {best.map((p) => (
            <ProductCard key={p.id} p={p} isB2B={isB2BApproved} />
          ))}
        </Rail>
      ) : null}

      {/* ============ VITRINE EM DESTAQUE ============ */}
      {loadingFeatured ? (
        <SectionShell title="Vitrine em destaque">
          <RailSkeleton />
        </SectionShell>
      ) : featured.length > 0 ? (
        <FeaturedShowcase products={featured} isB2B={isB2BApproved} />
      ) : null}

      {/* ============ MARCAS ============ */}
      <BrandsCarousel brands={brands} />

      {/* ============ BENEFÍCIOS FINAIS ============ */}
      <section className="container-x mt-12">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { icon: ShieldCheck, title: "Compra segura", desc: "Site 100% protegido" },
            { icon: Truck, title: "Entrega Brasil", desc: "Todos os estados" },
            { icon: MessageCircle, title: "Atendimento WhatsApp", desc: "Suporte rápido" },
            { icon: Handshake, title: "Atacado B2B", desc: "Preço especial CNPJ" },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 text-center"
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="font-display text-sm font-bold uppercase">{title}</div>
              <div className="text-[11px] text-muted-foreground">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="h-10" />
    </div>
  );
}

/* ================================================================== */
/*  Sub-components                                                    */
/* ================================================================== */

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        <h3 className="font-display text-2xl font-black uppercase leading-none md:text-3xl">
          {title}
        </h3>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground md:text-sm">{subtitle}</p>}
      </div>
    </div>
  );
}

function SectionShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="container-x mt-8">
      <SectionHeader title={title} subtitle={subtitle} />
      {children}
    </section>
  );
}

/* ---------- Fallback Hero ---------- */
function FallbackHero() {
  return (
    <section className="container-x">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-black via-secondary to-primary/70 p-8 text-white md:p-14">
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-black uppercase tracking-widest text-primary-foreground">
            <Zap className="h-3 w-3" /> PIX 5% OFF
          </span>
          <h1 className="mt-4 font-display text-4xl font-black uppercase leading-[0.95] md:text-6xl">
            Equipe seu carro com <span className="text-primary">ofertas de verdade</span>
          </h1>
          <p className="mt-3 max-w-lg text-sm text-white/80 md:text-base">
            Som, iluminação, segurança e acessórios com preço de varejo e atacado. Entrega para todo o Brasil.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/catalogo"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110"
            >
              Ver ofertas <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/b2b"
              className="inline-flex items-center gap-2 rounded-md border border-white/30 bg-white/10 px-6 py-3 text-sm font-bold uppercase text-white backdrop-blur hover:bg-white/20"
            >
              Comprar no atacado
            </Link>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-10 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
      </div>
    </section>
  );
}

/* ---------- Mini Banners ---------- */
interface MiniBannerRow {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  link_url: string | null;
  cta_label: string | null;
}

function MiniBannersGrid({ banners }: { banners: MiniBannerRow[] }) {
  const defaults: {
    id: string;
    title: string;
    subtitle: string;
    to: string;
    accent: string;
    icon: React.ComponentType<{ className?: string }>;
    cta: string;
  }[] = [
    {
      id: "d1",
      title: "Super LED em promoção",
      subtitle: "Faróis que enxergam mais longe",
      to: "/catalogo",
      accent: "from-primary/90 to-primary/40",
      icon: Lightbulb,
      cta: "Ver iluminação",
    },
    {
      id: "d2",
      title: "Multimídia e som",
      subtitle: "Do central 2 DIN ao subwoofer",
      to: "/catalogo",
      accent: "from-secondary to-primary/60",
      icon: Volume2,
      cta: "Ver som automotivo",
    },
    {
      id: "d3",
      title: "Segurança e alarmes",
      subtitle: "Proteja seu carro 24h",
      to: "/catalogo",
      accent: "from-black to-secondary",
      icon: ShieldCheck,
      cta: "Ver segurança",
    },
    {
      id: "d4",
      title: "Atacado para oficinas",
      subtitle: "Preço CNPJ e pedido faturado",
      to: "/b2b",
      accent: "from-primary via-primary/70 to-black",
      icon: Wrench,
      cta: "Compre no atacado",
    },
  ];

  const items =
    banners.length > 0
      ? banners.slice(0, 4).map((b) => ({
          real: true as const,
          id: b.id,
          title: b.title,
          subtitle: b.subtitle ?? "",
          to: (b.link_url ?? "/catalogo") as string,
          image: b.image_url,
          cta: b.cta_label ?? "Ver mais",
        }))
      : defaults.map((d) => ({ real: false as const, ...d }));

  return (
    <section className="container-x mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((it) =>
        it.real ? (
          <Link
            key={it.id}
            to={it.to as never}
            className="group relative aspect-[16/10] overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-brand)]"
          >
            <img
              src={it.image}
              alt={it.title}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-end p-4 text-white">
              <div className="font-display text-lg font-black uppercase leading-tight">{it.title}</div>
              {it.subtitle && <div className="mt-0.5 text-xs text-white/80">{it.subtitle}</div>}
              <span className="mt-2 inline-flex w-fit items-center gap-1 rounded bg-primary px-3 py-1 text-[10px] font-bold uppercase text-primary-foreground">
                {it.cta} <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </Link>
        ) : (
          <Link
            key={it.id}
            to={it.to as never}
            className={`group relative aspect-[16/10] overflow-hidden rounded-xl bg-gradient-to-br ${it.accent} p-5 text-white shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-brand)]`}
          >
            <it.icon className="absolute -right-4 -top-4 h-32 w-32 text-white/10" />
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div>
                <div className="font-display text-lg font-black uppercase leading-tight">{it.title}</div>
                <div className="mt-1 text-xs text-white/85">{it.subtitle}</div>
              </div>
              <span className="inline-flex w-fit items-center gap-1 rounded bg-white/15 px-3 py-1 text-[10px] font-bold uppercase text-white backdrop-blur">
                {it.cta} <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </Link>
        )
      )}
    </section>
  );
}

/* ---------- Featured Showcase ---------- */
function FeaturedShowcase({
  products,
  isB2B,
}: {
  products: React.ComponentProps<typeof ProductCard>["p"][];
  isB2B: boolean;
}) {
  const [main, ...rest] = products;
  if (!main) return null;
  const sideItems = rest.slice(0, 4);

  return (
    <section className="container-x mt-10">
      <SectionHeader title="Vitrine em destaque" subtitle="Selecionados para você" />
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Featured hero product */}
        <Link
          to="/produto/$slug"
          params={{ slug: main.slug }}
          className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-secondary via-black to-secondary p-6 text-white shadow-[var(--shadow-card)] transition hover:shadow-[var(--shadow-brand)] lg:col-span-2 lg:flex-row"
        >
          <div className="flex flex-1 flex-col justify-center gap-3">
            <span className="w-fit rounded bg-primary px-2 py-1 text-[10px] font-black uppercase tracking-widest">
              Destaque
            </span>
            <h4 className="font-display text-2xl font-black uppercase leading-tight md:text-4xl">
              {main.name}
            </h4>
            {main.short_description && (
              <p className="max-w-md text-sm text-white/70 line-clamp-3">{main.short_description}</p>
            )}
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-3xl font-black text-primary">
                {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                  main.price_b2c
                )}
              </span>
              {main.compare_at_price && main.compare_at_price > main.price_b2c && (
                <span className="text-sm text-white/50 line-through">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                    main.compare_at_price
                  )}
                </span>
              )}
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)]">
              Ver produto <ArrowRight className="h-4 w-4" />
            </span>
          </div>
          <div className="relative mt-4 flex aspect-square w-full items-center justify-center lg:mt-0 lg:w-1/2">
            {main.images?.[0]?.url ? (
              <img
                src={main.images[0].url}
                alt={main.name}
                loading="lazy"
                className="max-h-64 w-auto object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)] transition group-hover:scale-105"
              />
            ) : (
              <Package className="h-32 w-32 text-white/20" />
            )}
          </div>
        </Link>

        {/* Side cards */}
        <div className="grid grid-cols-2 gap-3">
          {sideItems.map((p) => (
            <ProductCard key={p.id} p={p} isB2B={isB2B} />
          ))}
          {sideItems.length === 0 && (
            <div className="col-span-2 grid place-items-center rounded-lg border border-dashed border-border p-6 text-xs text-muted-foreground">
              Cadastre mais produtos em destaque
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- B2B Block ---------- */
function B2BBlock() {
  return (
    <section className="container-x mt-12">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-secondary via-black to-primary/70 p-8 text-white md:p-12">
        <div className="relative z-10 grid gap-8 md:grid-cols-2">
          <div>
            <span className="rounded bg-primary px-2 py-1 text-[10px] font-black uppercase tracking-widest text-primary-foreground">
              B2B · Atacado
            </span>
            <h3 className="mt-3 font-display text-3xl font-black uppercase leading-tight md:text-4xl">
              Você é lojista, oficina ou revendedor?
            </h3>
            <p className="mt-2 max-w-lg text-sm text-white/80 md:text-base">
              Cadastre seu CNPJ e acesse tabela especial de atacado, condições comerciais e catálogo
              completo pronto para revenda.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                to="/b2b"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110"
              >
                Cadastrar no atacado <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/b2b"
                className="inline-flex items-center gap-2 rounded-md border border-white/30 bg-white/10 px-6 py-3 text-sm font-bold uppercase text-white backdrop-blur hover:bg-white/20"
              >
                Saiba como funciona
              </Link>
            </div>
          </div>

          <div className="grid gap-3 self-center sm:grid-cols-1">
            {[
              { icon: Percent, title: "Preço especial por grupo", desc: "Tabela dedicada ao seu perfil" },
              { icon: Users, title: "Pedido assistido", desc: "Vendedor Norte Sul dedicado" },
              { icon: Package, title: "Catálogo para revenda", desc: "Portfólio completo à disposição" },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3 backdrop-blur"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/20 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-sm font-bold uppercase">{title}</div>
                  <div className="text-xs text-white/70">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-16 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
      </div>
    </section>
  );
}

/* ---------- Brands Carousel ---------- */
function BrandsCarousel({
  brands,
}: {
  brands: { id: string; name: string; slug: string; logo_url: string | null }[];
}) {
  const placeholders = ["JBL", "Pioneer", "Positron", "Bosch", "Michelin", "Pirelli", "Taramps", "Multilaser"];
  const items =
    brands.length > 0
      ? brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug, logo: b.logo_url }))
      : placeholders.map((n) => ({ id: n, name: n, slug: n.toLowerCase(), logo: null as string | null }));

  return (
    <section className="container-x mt-12">
      <SectionHeader title="Marcas parceiras" subtitle="Trabalhamos só com marcas de confiança" />
      <div className="scroll-rail">
        {items.map((b) => (
          <Link
            key={b.id}
            to="/catalogo"
            search={{ brand: b.slug } as never}
            className="grid h-20 w-40 shrink-0 place-items-center rounded-lg border border-border bg-card p-3 transition hover:-translate-y-0.5 hover:border-primary hover:shadow-[var(--shadow-brand)]"
          >
            {b.logo ? (
              <img src={b.logo} alt={b.name} loading="lazy" className="max-h-12 max-w-full object-contain" />
            ) : (
              <span className="font-display text-lg font-black uppercase tracking-wider text-muted-foreground">
                {b.name}
              </span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
