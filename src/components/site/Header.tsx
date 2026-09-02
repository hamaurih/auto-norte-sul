import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, ShoppingCart, User, Wrench, Menu, LogOut, Car, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchSearchSuggestions } from "@/lib/queries";
import { useCart } from "@/lib/cart-store";
import { useSession } from "@/lib/session";
import { brl } from "@/lib/format";
import { CompanyLogo } from "@/components/site/CompanyLogo";
import { useCompanyProfile } from "@/lib/company";

export function Header() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
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
        .select("id, name, slug, icon, sort_order")
        .eq("tenant_id", company.tenant_id)
        .eq("active", true)
        .is("parent_id", null)
        .order("sort_order");
      if (error) {
        console.error("Erro ao carregar departamentos da loja", error);
        return [];
      }
      return data ?? [];
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
    queryKey: ["search-suggestions", debounced],
    queryFn: () => fetchSearchSuggestions(debounced, 8),
    enabled,
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

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-secondary text-secondary-foreground">
      {/* Top strip */}
      <div className="border-b border-white/10 bg-black/30 text-[11px]">
        <div className="container-x flex h-8 items-center justify-between">
          <span className="hidden sm:inline">Frete para todo Brasil · PIX com 5% OFF · 10x sem juros</span>
          <div className="flex items-center gap-3">
            <Link to="/b2b" className="hover:text-primary">Compre no Atacado (B2B)</Link>
            <span className="opacity-40">|</span>
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="hover:text-primary">WhatsApp</a>
          </div>
        </div>
      </div>

      {/* Main bar */}
      <div className="container-x flex items-center gap-3 py-3">
        <button
          className="md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
        >
          <Menu className="h-6 w-6" />
        </button>

        <Link to="/" className="group flex items-center" aria-label={`${company?.trade_name || "Loja"} - Início`}>
          <CompanyLogo className="h-14 w-auto drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-transform duration-300 group-hover:scale-105 md:h-16" />
        </Link>

        <div ref={boxRef} className="relative ml-auto flex flex-1 max-w-2xl">
          <form onSubmit={submit} className="flex w-full items-center rounded-md bg-white text-foreground">
            <div className="hidden items-center gap-1 border-r border-border px-3 text-xs font-semibold text-muted-foreground sm:flex">
              <span>SKU · Produto · Marca · Aplicação</span>
            </div>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
                setHighlight(-1);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="Busque por SKU, produto, marca, aplicação ou modelo do carro"
              className="flex-1 bg-transparent px-3 py-2 text-sm outline-none"
              autoComplete="off"
            />
            <button className="grid h-full aspect-square place-items-center rounded-r-md bg-primary px-3 text-primary-foreground" aria-label="Buscar">
              {isFetching && enabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
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
                            <div className="line-clamp-2 text-xs font-medium leading-tight">{s.name}</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">SKU {s.sku}</div>
                          </div>
                          <div className="shrink-0 text-sm font-bold text-primary">{brl(s.price_b2c)}</div>
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

        <nav className="ml-auto flex items-center gap-1">
          {user ? (
            <>
              <Link to="/conta" className="hidden items-center gap-1 rounded px-2 py-1 text-sm hover:text-primary md:flex">
                <User className="h-4 w-4" /> Minha Conta
              </Link>
              {isSalesRep && (
                <Link to="/vendedor" className="hidden items-center gap-1 rounded bg-hot px-2 py-1 text-xs font-bold uppercase text-hot-foreground md:flex">
                  Vendedor
                </Link>
              )}
              {isStaff && (
                <Link to="/admin" className="hidden items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-bold uppercase text-primary-foreground md:flex">
                  <Wrench className="h-3 w-3" /> Admin
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
            <Link to="/auth" className="hidden items-center gap-1 rounded px-2 py-1 text-sm hover:text-primary md:flex">
              <User className="h-4 w-4" /> Entrar
            </Link>
          )}
          <Link to="/carrinho" className="relative flex items-center gap-1 rounded px-2 py-1 text-sm hover:text-primary">
            <ShoppingCart className="h-5 w-5" />
            {count > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {count}
              </span>
            )}
          </Link>
        </nav>
      </div>

      {/* Departments */}
      <div className="border-t border-white/10 bg-black/20">
        <div className="container-x scroll-rail py-2 text-sm">
          {categories.map((c) => (
            <Link
              key={c.id}
              to="/catalogo"
              search={{ category: c.slug } as never}
              className="whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition hover:border-primary hover:bg-primary hover:text-primary-foreground"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Mobile menu drop */}
      {menuOpen && (
        <div className="border-t border-white/10 bg-secondary p-4 md:hidden">
          <div className="flex flex-col gap-2 text-sm">
            <Link to="/" onClick={() => setMenuOpen(false)}>Home</Link>
            <Link to="/catalogo" onClick={() => setMenuOpen(false)}>Catálogo</Link>
            <Link to="/b2b" onClick={() => setMenuOpen(false)}>Compre no Atacado</Link>
            {user ? (
              <>
                <Link to="/conta" onClick={() => setMenuOpen(false)}>Minha conta</Link>
                <Link to="/pedidos" onClick={() => setMenuOpen(false)}>Meus pedidos</Link>
                {isStaff && <Link to="/admin" onClick={() => setMenuOpen(false)}>Painel Admin</Link>}
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
              <Link to="/auth" onClick={() => setMenuOpen(false)}>Entrar / Cadastrar</Link>
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
