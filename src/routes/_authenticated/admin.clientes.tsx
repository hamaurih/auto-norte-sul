import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  CircleCheck,
  DatabaseZap,
  Loader2,
  RefreshCw,
  Search,
  UserCheck,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { activeTenant, useAccessContext } from "@/lib/access";
import {
  getBlingCustomerCutoverStatus,
  importBlingCustomersCutover,
} from "@/lib/bling-customers-cutover.functions";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/admin/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes · Norte Sul" },
      { name: "description", content: "Carteira de clientes da Norte Sul, incluindo migração controlada do Bling." },
    ],
  }),
  component: CustomersPage,
});

const PAGE_SIZE = 50;

function onlyDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function formatDocument(value: string | null) {
  const d = onlyDigits(value);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value || "—";
}

function groupLabel(value: string) {
  const labels: Record<string, string> = {
    b2c: "Consumidor",
    b2b_pendente: "B2B pendente",
    revendedor: "Revendedor",
    oficina: "Oficina",
    distribuidor: "Distribuidor",
  };
  return labels[value] ?? value;
}

function CustomersPage() {
  const qc = useQueryClient();
  const { data: access } = useAccessContext();
  const tenant = activeTenant(access);
  const { isAdmin } = useSession();
  const getStatus = useServerFn(getBlingCustomerCutoverStatus);
  const importCustomers = useServerFn(importBlingCustomersCutover);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["bling-customer-cutover-status", tenant?.id],
    queryFn: () => getStatus(),
    enabled: Boolean(tenant?.id && isAdmin),
    retry: false,
  });

  const customersQuery = useQuery({
    queryKey: ["admin-customers", tenant?.id, search, page],
    enabled: Boolean(tenant?.id),
    queryFn: async () => {
      if (!tenant?.id) return { rows: [] as any[], count: 0 };
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from("customers")
        .select("id,name,trade_name,email,phone,document,customer_group,b2b_status,active,source,bling_id,city,state,created_at,imported_at", { count: "exact" })
        .eq("tenant_id", tenant.id)
        .order("name", { ascending: true })
        .range(from, to);

      const term = search.trim().replace(/[,%()]/g, " ");
      if (term) {
        query = query.or(`name.ilike.%${term}%,trade_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,document.ilike.%${term}%`);
      }
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const rows = customersQuery.data?.rows ?? [];
  const total = customersQuery.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeCount = useMemo(() => rows.filter((row) => row.active).length, [rows]);
  const blingCount = statusQuery.data?.importedFromBling ?? rows.filter((row) => row.source === "bling_cutover").length;

  async function runImport() {
    setImporting(true);
    try {
      const result = await importCustomers();
      if (result.failures?.length) {
        toast.warning(`Importação concluída com ${result.failures.length} alerta(s).`);
      } else {
        toast.success(`Carteira importada: ${result.inserted} novos clientes e ${result.linkedByDocument} cadastros vinculados.`);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["admin-customers"] }),
        qc.invalidateQueries({ queryKey: ["bling-customer-cutover-status"] }),
      ]);
      setPage(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível importar os clientes do Bling.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Gestão comercial</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Clientes</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Carteira central do ERP. Clientes migrados do Bling passam a ser administrados pela Norte Sul sem sincronização automática de entrada.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Link
              to="/admin/ecossistema/bling"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-bold transition hover:bg-muted"
            >
              <DatabaseZap className="h-4 w-4" /> Bling
            </Link>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={importing || !statusQuery.data?.connected}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Importar carteira do Bling
            </button>
          </div>
        )}
      </header>

      {isAdmin && statusQuery.data && !statusQuery.data.connected && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-bold">A autorização do Bling ainda não está no ambiente oficial.</div>
            <div className="mt-1 text-amber-800">Reconecte o Bling uma única vez; depois volte aqui e importe toda a carteira.</div>
          </div>
          <Link to="/admin/ecossistema/bling" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-amber-900 px-4 font-bold text-white">
            Reconectar Bling
          </Link>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Clientes</span><Users className="h-5 w-5 text-blue-600" /></div>
          <div className="mt-2 text-3xl font-extrabold tabular-nums">{total}</div>
          <p className="mt-1 text-xs text-muted-foreground">No ambiente ativo</p>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Importados do Bling</span><DatabaseZap className="h-5 w-5 text-violet-600" /></div>
          <div className="mt-2 text-3xl font-extrabold tabular-nums">{blingCount}</div>
          <p className="mt-1 text-xs text-muted-foreground">Migração única e rastreável</p>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Ativos nesta página</span><UserCheck className="h-5 w-5 text-emerald-600" /></div>
          <div className="mt-2 text-3xl font-extrabold tabular-nums">{activeCount}</div>
          <p className="mt-1 text-xs text-muted-foreground">De {rows.length} exibidos</p>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Fonte oficial</span><CircleCheck className="h-5 w-5 text-emerald-600" /></div>
          <div className="mt-3 font-extrabold">ERP Norte Sul</div>
          <p className="mt-1 text-xs text-muted-foreground">Bling fica somente como legado</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail…"
              className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <span className="text-xs font-semibold text-muted-foreground">{total} {total === 1 ? "cliente" : "clientes"}</span>
        </div>

        {customersQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando carteira…</div>
        ) : customersQuery.error ? (
          <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {customersQuery.error instanceof Error ? customersQuery.error.message : "Falha ao carregar clientes."}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
            <Users className="h-10 w-10 text-muted-foreground/50" />
            <h2 className="mt-3 font-display text-xl font-bold">Nenhum cliente encontrado</h2>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              {search ? "Nenhum cadastro corresponde à busca." : "A carteira ainda não foi migrada para o ERP oficial."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">CPF / CNPJ</th>
                  <th className="px-4 py-3">Contato</th>
                  <th className="px-4 py-3">Grupo</th>
                  <th className="px-4 py-3">Cidade</th>
                  <th className="px-4 py-3">Origem</th>
                  <th className="px-4 py-3">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((customer) => (
                  <tr key={customer.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-bold">{customer.name}</div>
                      {customer.trade_name && customer.trade_name !== customer.name && <div className="text-xs text-muted-foreground">{customer.trade_name}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{formatDocument(customer.document)}</td>
                    <td className="px-4 py-3">
                      <div>{customer.phone || "—"}</div>
                      <div className="max-w-[220px] truncate text-xs text-muted-foreground">{customer.email || "—"}</div>
                    </td>
                    <td className="px-4 py-3"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{groupLabel(customer.customer_group)}</span></td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {[customer.city, customer.state].filter(Boolean).join("/") || "—"}</span></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${customer.source === "bling_cutover" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-700"}`}>{customer.source === "bling_cutover" ? "Bling migrado" : "ERP"}</span></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${customer.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{customer.active ? "Ativo" : "Inativo"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border px-3 py-2 font-semibold disabled:opacity-40">Anterior</button>
            <span className="text-muted-foreground">Página {page} de {pages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="rounded-lg border px-3 py-2 font-semibold disabled:opacity-40">Próxima</button>
          </div>
        )}
      </section>
    </div>
  );
}
