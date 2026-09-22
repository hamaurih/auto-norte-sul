import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Car,
  Grid2X2,
  Loader2,
  LogOut,
  Menu,
  Search,
  ShoppingCart,
  Truck,
  User,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchSearchSuggestions } from "@/lib/queries";
import { useCart } from "@/lib/cart-store";
import { useSession } from "@/lib/session";
import { brl } from "@/lib/format";
import { CompanyLogo } from "@/components/site/CompanyLogo";
import { useCompanyProfile } from "@/lib/company";

const STORE_NAVIGATION = [
  { slug: "som-automotivo", label: "Som e multimídia" },
  { slug: "iluminacao", label: "Iluminação" },
  { slug: "seguranca", label: "Segurança" },
  { slug: "acessorios-internos", label: "Interior" },
  { slug: "carroceria-exterior", label: "Acessórios externos" },
];

type TaxonomyNode = { id: string; name: string; slug: string; parent_id: string | null; sort_order: number };

export function Header() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [departmentsOpen, setDepartmentsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const { count } = useCart();
  const { data: company } = useCompanyProfile();
  const whatsappHref = company?.whatsapp
    ? `https://wa.me/${company.whatsapp.replace(/\D/g, "")}`
    : "#";
  const { user, isStaff, isSalesRep, isB2BApproved } = useSession();
  const { data: categories = [] } = useQuery({
    queryKey: ["categories", company?.tenant_id],
    enabled: Boolean(company?.tenant_id),
    queryFn: async () => {
      if (!company?.tenant_id) return [];
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, slug, parent_id, sort_order")
        .eq("tenant_id", company.tenant_id)
        .eq("active", true)
        .order("sort_order");
      if (error) {
        console.error("Erro ao carregar departamentos da loja", error);
        return [];
      }
      return (data ?? []) as TaxonomyNode[];
    },
    staleTime: 60_000,
  });

  // Debounce term (250ms)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const enabled = debounced.length >= 2;
  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: ["search-suggestions", company?.tenant_id, debounced],
    queryFn: () => fetchSearchSuggestions(debounced, 8, company?.tenant_id),
    enabled: enabled && Boolean(company?.tenant_id),
    staleTime: 30_000,
  });

  // Click outside closes dropdown
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDepartmentsOpen(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function goToCatalog(term: string) {
    setOpen(false);
    navigate({ to: "/catalogo", search: { q: term } as never });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (highlight >= 0 && suggestions[highlight]) {
      const s = suggestions[highlight];
      setOpen(false);
      navigate({ to: "/produto/$slug", params: { slug: s.slug } });
      return;
    }
    goToCatalog(q);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showDropdown = open && enabled && (isFetching || suggestions.length > 0);
  const departments = categories.filter((category) => !category.parent_id && !category.slug.startsWith("bling-"));
  const childrenByParent = new Map<string, TaxonomyNode[]>();
  for (const category of categories) {
    if (!category.parent_id) continue;
    const children = childrenByParent.get(category.parent_id) ?? [];
    children.push(category);
    childrenByParent.set(category.parent_id, children);
  }
  const navigation = STORE_NAVIGATION.flatMap((item) => {
    const category = departments.find((candidate) => candidate.slug === item.slug);
    return category ? [{ ...item, category }] : [];
  });

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 text-foreground shadow-sm backdrop-blur-xl">
      {/* Top strip */}
      <div className="border-b border-white/10 bg-slate-950 text-[11px] text-white/85">
        <div className="container-x flex h-8 items-center justify-between">
          <span className="hidden font-medium sm:inline">
            Frete para todo Brasil · PIX com 5% OFF · 10x sem juros
          </span>
          <div className="flex items-center gap-3">
            <Link to="/b2b" className="font-medium hover:text-primary">
              Área de atacado
            </Link>
            <span className="opacity-40">|</span>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary"
            >
              WhatsApp
            </a>
          </div>
        </div>
      </div>

      {/* Main bar */}
      <div className="container-x flex flex-wrap items-center gap-3 py-2.5 md:flex-nowrap">
        <button
          className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transform-none md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
        >
          <Menu className="h-6 w-6" />
        </button>

        <Link
          to="/"
          className="group flex shrink-0 items-center"
          aria-label={`${company?.trade_name || "Loja"} - Início`}
        >
          <CompanyLogo className="h-12 w-auto drop-shadow-[0_2px_8px_rgba(0,0,0,0.25)] transition-transform duration-300 group-hover:scale-[1.03] md:h-[3.65rem]" />
        </Link>

        <div
          ref={boxRef}
          className="order-3 relative flex w-full basis-full md:order-none md:ml-5 md:flex-1 md:basis-auto md:max-w-3xl"
        >
          <form
            onSubmit={submit}
            className="flex w-full items-center rounded-2xl border border-slate-200 bg-slate-50 text-foreground shadow-sm transition-shadow focus-within:border-primary/60 focus-within:bg-white focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_14%,transparent)]"
          >
            <Search className="ml-4 size-4 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
                setHighlight(-1);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="Busque peça, código, marca ou veículo"
              className="flex-1 bg-transparent px-3 py-3 text-sm outline-none"
              autoComplete="off"
            />
            <button
              className="m-1 grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-[transform,filter] duration-150 ease-out hover:brightness-110 active:scale-[0.96] motion-reduce:transform-none"
              aria-label="Buscar"
            >
              {isFetching && enabled ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </button>
          </form>

          {showDropdown && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-white text-foreground shadow-2xl">
              {suggestions.length === 0 && isFetching ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">Buscando…</div>
              ) : (
                <>
                  <ul className="max-h-[70vh] overflow-y-auto">
                    {suggestions.map((s, idx) => (
                      <li key={s.id}>
                        <Link
                          to="/produto/$slug"
                          params={{ slug: s.slug }}
                          onClick={() => {
                            setOpen(false);
                            setQ("");
                          }}
                          onMouseEnter={() => setHighlight(idx)}
                          className={`flex items-center gap-3 px-3 py-2 text-left transition ${
                            idx === highlight ? "bg-primary/10" : "hover:bg-muted"
                          }`}
                        >
                          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded bg-muted">
                            {s.image ? (
                              <img
                                src={s.image}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Car className="h-5 w-5 text-muted-foreground/50" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-xs font-medium leading-tight">
                              {s.name}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              SKU {s.sku}
                            </div>
                          </div>
                          <div className="shrink-0 text-sm font-bold text-primary">
                            {brl(s.price_b2c)}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => goToCatalog(q)}
                    className="block w-full border-t border-border bg-muted/50 px-3 py-2 text-center text-xs font-bold uppercase tracking-wider text-primary hover:bg-muted"
                  >
                    Ver todos os resultados para “{q}”
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <nav className="ml-auto flex shrink-0 items-center gap-1">
          {user ? (
            <>
              {!isStaff && (
                <Link
                  to="/conta"
                  className="hidden items-center gap-1 rounded px-2 py-1 text-sm hover:text-primary md:flex"
                >
                  <User className="h-4 w-4" /> Minha Conta
                </Link>
              )}
              {isSalesRep && (
                <Link
                  to="/vendedor"
                  className="hidden items-center gap-1 rounded bg-hot px-2 py-1 text-xs font-bold uppercase text-hot-foreground md:flex"
                >
                  Vendedor
                </Link>
              )}
              {isStaff && (
                <Link
                  to="/admin"
                  className="hidden items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-bold uppercase text-primary-foreground md:flex"
                >
                  <Wrench className="h-3.5 w-3.5" /> <span className="sr-only">Administração</span>
                </Link>
              )}
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate({ to: "/" });
                }}
                title="Sair"
                className="hidden md:inline-flex rounded p-2 hover:text-primary"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              className="hidden items-center gap-1 rounded px-2 py-1 text-sm hover:text-primary md:flex"
            >
              <User className="h-4 w-4" /> Entrar
            </Link>
          )}
          <Link
            to="/carrinho"
            className="relative flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm transition-[transform,border-color,color] duration-150 ease-out hover:border-primary hover:text-primary active:scale-[0.96] motion-reduce:transform-none"
          >
            <ShoppingCart className="h-5 w-5" />
            {count > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {count}
              </span>
            )}
          </Link>
        </nav>
      </div>

      {/* Primary commerce navigation */}
      <div className="border-y border-slate-200 bg-white">
        <nav
          className="container-x flex h-11 items-center gap-1 overflow-x-auto text-sm"
          aria-label="Navegação da loja"
        >
          <button
            type="button"
            onClick={() => setDepartmentsOpen((isOpen) => !isOpen)}
            aria-expanded={departmentsOpen}
            aria-controls="departments-panel"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white transition-[transform,background-color] duration-150 ease-out hover:bg-primary active:scale-[0.97] motion-reduce:transform-none"
          >
            <Grid2X2 className="size-3.5" /> Departamentos
          </button>
          {navigation.map(({ category, label }) => (
            <Link
              key={category.id}
              to="/catalogo"
              search={{ category: category.slug } as never}
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-primary"
            >
              {label}
            </Link>
          ))}
          <Link
            to="/b2b"
            className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-300"
          >
            <Truck className="size-3.5" /> Comprar no atacado
          </Link>
        </nav>
      </div>

      {departmentsOpen && (
        <section
          id="departments-panel"
          aria-label="Todos os departamentos"
          className="absolute inset-x-0 top-full z-50 border-b border-slate-200 bg-white/95 shadow-2xl backdrop-blur-xl"
        >
          <div className="container-x max-h-[calc(100dvh-9rem)] overflow-y-auto py-5 md:max-h-[32rem]">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-950">Encontre pelo tipo de produto</p>
                <p className="mt-1 text-xs text-slate-500">
                  Acesse uma família ou veja todo o catálogo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDepartmentsOpen(false)}
                className="grid size-9 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 transition-[transform,background-color] duration-150 ease-out hover:bg-slate-100 active:scale-[0.96] motion-reduce:transform-none"
                aria-label="Fechar departamentos"
              >
                <X className="size-4" />
              </button>
            </div>

            {navigation.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Mais procurados
                </p>
                <div className="flex flex-wrap gap-2">
                  {navigation.map(({ category, label }) => (
                    <Link
                      key={category.id}
                      to="/catalogo"
                      search={{ category: category.slug } as never}
                      onClick={() => setDepartmentsOpen(false)}
                      className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-primary hover:text-white"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {departments.map((department) => {
                const groups = childrenByParent.get(department.id) ?? [];
                return (
                  <div key={department.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    <Link to="/catalogo" search={{ category: department.slug } as never} onClick={() => setDepartmentsOpen(false)} className="text-sm font-extrabold text-slate-950 hover:text-primary">
                      {department.name}
                    </Link>
                    <div className="mt-2 space-y-2">
                      {groups.map((group) => {
                        const leaves = childrenByParent.get(group.id) ?? [];
                        return <div key={group.id}>
                          <Link to="/catalogo" search={{ category: group.slug } as never} onClick={() => setDepartmentsOpen(false)} className="text-xs font-bold text-slate-700 hover:text-primary">{group.name}</Link>
                          {leaves.length > 0 && <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">{leaves.slice(0, 6).map((leaf) => <Link key={leaf.id} to="/catalogo" search={{ category: leaf.slug } as never} onClick={() => setDepartmentsOpen(false)} className="text-[11px] text-slate-500 hover:text-primary hover:underline">{leaf.name}</Link>)}</div>}
                        </div>;
                      })}
                    </div>
                  </div>
                );
              })}
              <Link
                to="/catalogo"
                onClick={() => setDepartmentsOpen(false)}
                className="rounded-xl bg-slate-950 px-3 py-3 text-xs font-bold text-white transition-[transform,background-color] duration-150 ease-out hover:bg-primary active:scale-[0.98] motion-reduce:transform-none"
              >
                Ver catálogo completo →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Mobile menu drop */}
      {menuOpen && (
        <div className="border-t border-border bg-background p-4 md:hidden">
          <div className="flex flex-col gap-2 text-sm">
            <Link to="/" onClick={() => setMenuOpen(false)}>
              Home
            </Link>
            <Link to="/catalogo" onClick={() => setMenuOpen(false)}>
              Todos os departamentos
            </Link>
            <Link to="/b2b" onClick={() => setMenuOpen(false)}>
              Compre no Atacado
            </Link>
            {user ? (
              <>
                {!isStaff && (
                  <Link to="/conta" onClick={() => setMenuOpen(false)}>
                    Minha conta
                  </Link>
                )}
                {!isStaff && (
                  <Link to="/pedidos" onClick={() => setMenuOpen(false)}>
                    Meus pedidos
                  </Link>
                )}
                {isStaff && (
                  <Link to="/admin" onClick={() => setMenuOpen(false)}>
                    Painel Admin
                  </Link>
                )}
                <button
                  className="text-left text-primary"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setMenuOpen(false);
                  }}
                >
                  Sair
                </button>
              </>
            ) : (
              <Link to="/auth" onClick={() => setMenuOpen(false)}>
                Entrar / Cadastrar
              </Link>
            )}
            {isB2BApproved && (
              <span className="mt-2 rounded bg-success px-2 py-1 text-xs font-bold uppercase text-success-foreground">
                Preço atacado ativo
              </span>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
