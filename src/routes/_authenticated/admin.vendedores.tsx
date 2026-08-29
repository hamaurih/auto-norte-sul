import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Plus, Save, Target, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  calculateSellerCommission,
  getCommercialAdminData,
  saveB2BPriceSettings,
  saveCustomerPriceTable,
  saveSalesRepSettings,
  saveSellerGoal,
  type CommercialAdminData,
} from "@/lib/commercial.functions";
import {
  getSellerCreditAdminData,
  saveSellerCreditSettings,
} from "@/lib/seller-credit.functions";
import { supabase } from "@/integrations/supabase/client";
import { fetchTenantAccess, isTenantStaff } from "@/lib/tenant-access";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/admin/vendedores")({
  head: () => ({ meta: [{ title: "Vendedores · Norte Sul" }] }),
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });
    const access = await fetchTenantAccess(userRes.user.id);
    if (!isTenantStaff(access)) throw redirect({ to: "/" });
  },
  component: VendedoresList,
});

const monthNow = new Date().toISOString().slice(0, 7);
const inputClass = "mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm";

function VendedoresList() {
  const qc = useQueryClient();
  const commercial = useServerFn(getCommercialAdminData);
  const savePrices = useServerFn(saveB2BPriceSettings);
  const saveCustomerTable = useServerFn(saveCustomerPriceTable);
  const saveRep = useServerFn(saveSalesRepSettings);
  const saveGoal = useServerFn(saveSellerGoal);
  const calculate = useServerFn(calculateSellerCommission);
  const creditAdmin = useServerFn(getSellerCreditAdminData);
  const saveCredit = useServerFn(saveSellerCreditSettings);

  const query = useQuery({
    queryKey: ["commercial-admin"],
    queryFn: () => commercial(),
  });
  const data = query.data as CommercialAdminData | undefined;
  const creditQuery = useQuery({
    queryKey: ["seller-credit-admin"],
    queryFn: () => creditAdmin(),
  });

  const [priceForm, setPriceForm] = useState({ table_a_discount_pct: 8, table_b_discount_pct: 5, table_c_discount_pct: 0, active: true });
  const [creditForm, setCreditForm] = useState({ enabled: false, max_uplift_pct: 3, tax_rate_pct: 0, max_credit_use_pct: 100 });
  const [goalForm, setGoalForm] = useState({ rep_id: "", period_month: monthNow, target_amount: 0, target_units: 0 });
  const [calculatingRep, setCalculatingRep] = useState<string | null>(null);

  useEffect(() => {
    if (data?.priceSettings) setPriceForm(data.priceSettings);
    if (data?.reps.length && !goalForm.rep_id) setGoalForm((current) => ({ ...current, rep_id: data.reps[0].id }));
    if (creditQuery.data?.settings) setCreditForm(creditQuery.data.settings);
  }, [data?.priceSettings, data?.reps, goalForm.rep_id, creditQuery.data?.settings]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["commercial-admin"] });
  const invalidateCredit = () => qc.invalidateQueries({ queryKey: ["seller-credit-admin"] });

  const priceMutation = useMutation({
    mutationFn: () => savePrices({ data: priceForm }),
    onSuccess: () => { toast.success("Tabelas B2B atualizadas"); invalidate(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível salvar as tabelas"),
  });

  const customerMutation = useMutation({
    mutationFn: (value: { customer_id: string; price_table: "A" | "B" | "C" }) => saveCustomerTable({ data: value }),
    onSuccess: () => { toast.success("Tabela do cliente atualizada"); invalidate(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível vincular a tabela"),
  });

  const repMutation = useMutation({
    mutationFn: (value: { rep_id: string; max_discount_pct: number; commission_pct: number }) => saveRep({ data: value }),
    onSuccess: () => { toast.success("Limite do vendedor atualizado"); invalidate(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o vendedor"),
  });

  const goalMutation = useMutation({
    mutationFn: () => saveGoal({ data: goalForm }),
    onSuccess: () => { toast.success("Meta salva"); invalidate(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível salvar a meta"),
  });

  const creditMutation = useMutation({
    mutationFn: () => saveCredit({ data: creditForm }),
    onSuccess: () => { toast.success("Regra de crédito comercial salva"); invalidateCredit(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível salvar a regra de crédito"),
  });

  async function calculateMonth(repId: string) {
    setCalculatingRep(repId);
    try {
      await calculate({ data: { rep_id: repId, period_month: monthNow } });
      toast.success("Comissão calculada com a regra dos 3 meses");
      invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível calcular a comissão");
    } finally {
      setCalculatingRep(null);
    }
  }

  if (query.isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando gestão comercial...</div>;
  if (query.isError || !data) return <div className="p-6 text-sm text-destructive">Não foi possível carregar a gestão comercial.</div>;

  const validB2BCustomers = data.customers.filter((customer) => customer.document?.replace(/\D/g, "").length === 14);

  return (
    <div className="container-x space-y-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase">Vendedores e regras comerciais</h1>
          <p className="mt-1 text-sm text-muted-foreground">Preços B2B por CNPJ, limite de desconto, metas e comissões.</p>
        </div>
        <Link to="/admin/vendedores/novo" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground hover:brightness-110">
          <Plus className="h-4 w-4" /> Novo vendedor
        </Link>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold uppercase">Tabelas de preço B2B</h2>
            <p className="text-xs text-muted-foreground">A e B são descontos sobre o preço B2B base. C mantém o valor original.</p>
          </div>
          <button type="button" onClick={() => priceMutation.mutate()} disabled={priceMutation.isPending} className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-xs font-bold uppercase text-primary-foreground disabled:opacity-50">
            <Save className="h-4 w-4" /> Salvar regras
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["table_a_discount_pct", "table_b_discount_pct", "table_c_discount_pct"] as const).map((key) => (
            <label key={key} className="text-xs font-bold uppercase">
              Tabela {key[6].toUpperCase()} — desconto %
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={priceForm[key]}
                onChange={(event) => setPriceForm({ ...priceForm, [key]: Number(event.target.value) || 0 })}
                className={inputClass}
              />
            </label>
          ))}
        </div>
        <p className="mt-3 rounded bg-muted p-3 text-xs">
          Regra aplicada no servidor: preço final = preço B2B base × (1 − tabela/100). O CNPJ do cliente define a tabela.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3">
          <h2 className="font-display text-xl font-bold uppercase">Tabela por CNPJ</h2>
          <p className="text-xs text-muted-foreground">Somente clientes com CNPJ válido podem receber uma tabela.</p>
        </div>
        {validB2BCustomers.length === 0 ? (
          <p className="rounded border border-dashed border-border p-4 text-sm text-muted-foreground">Nenhum cliente com CNPJ cadastrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr><th className="p-2">Cliente</th><th className="p-2">CNPJ</th><th className="p-2">Grupo</th><th className="p-2">Tabela</th></tr>
              </thead>
              <tbody>
                {validB2BCustomers.map((customer) => (
                  <tr key={customer.id} className="border-b border-border last:border-0">
                    <td className="p-2 font-medium">{customer.name}</td>
                    <td className="p-2 font-mono text-xs">{customer.document}</td>
                    <td className="p-2 text-xs uppercase">{customer.customer_group}</td>
                    <td className="p-2">
                      <select
                        value={customer.price_table ?? "C"}
                        onChange={(event) => customerMutation.mutate({ customer_id: customer.id, price_table: event.target.value as "A" | "B" | "C" })}
                        disabled={customerMutation.isPending}
                        className="rounded border border-border bg-background px-2 py-1 text-xs font-bold"
                      >
                        <option value="A">A — {priceForm.table_a_discount_pct}% off</option>
                        <option value="B">B — {priceForm.table_b_discount_pct}% off</option>
                        <option value="C">C — preço base</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3">
          <h2 className="font-display text-xl font-bold uppercase">Limite de desconto por vendedor</h2>
          <p className="text-xs text-muted-foreground">O limite é validado novamente no servidor ao salvar um pedido assistido.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-2">Vendedor</th><th className="p-2">Comissão base</th><th className="p-2">Desconto adicional máximo</th><th className="p-2">Ação</th></tr>
            </thead>
            <tbody>
              {data.reps.map((rep) => (
                <RepRow key={rep.id} rep={rep} saving={repMutation.isPending} onSave={(value) => repMutation.mutate(value)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-display text-xl font-bold uppercase">Metas mensais</h2>
            <p className="text-xs text-muted-foreground">Meta registrada por vendedor e competência.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4 md:items-end">
          <label className="text-xs font-bold uppercase">Vendedor
            <select value={goalForm.rep_id} onChange={(event) => setGoalForm({ ...goalForm, rep_id: event.target.value })} className={inputClass}>
              {data.reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.full_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase">Mês
            <input type="month" value={goalForm.period_month} onChange={(event) => setGoalForm({ ...goalForm, period_month: event.target.value })} className={inputClass} />
          </label>
          <label className="text-xs font-bold uppercase">Meta em R$
            <input type="number" min={0} step="0.01" value={goalForm.target_amount} onChange={(event) => setGoalForm({ ...goalForm, target_amount: Number(event.target.value) || 0 })} className={inputClass} />
          </label>
          <button type="button" onClick={() => goalMutation.mutate()} disabled={!goalForm.rep_id || goalMutation.isPending} className="rounded bg-primary px-3 py-2 text-xs font-bold uppercase text-primary-foreground disabled:opacity-50">Salvar meta</button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-2">Mês</th><th className="p-2">Vendedor</th><th className="p-2 text-right">Meta</th><th className="p-2 text-right">Unidades</th></tr>
            </thead>
            <tbody>
              {data.goals.slice(0, 20).map((goal) => (
                <tr key={goal.id} className="border-b border-border last:border-0">
                  <td className="p-2">{goal.period_month.slice(0, 7)}</td>
                  <td className="p-2">{data.reps.find((rep) => rep.id === goal.rep_id)?.full_name ?? "Vendedor"}</td>
                  <td className="p-2 text-right">{brl(goal.target_amount)}</td>
                  <td className="p-2 text-right">{goal.target_units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-bold uppercase">Comissões</h2>
            <p className="text-xs text-muted-foreground">Se o mês atual for maior que a média dos 3 meses anteriores: {data.commissionSettings.outperform_rate_pct}%. Caso contrário: {data.commissionSettings.baseline_rate_pct}%.</p>
          </div>
          <span className="rounded bg-muted px-2 py-1 text-xs font-semibold">Competência {monthNow}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr><th className="p-2">Vendedor</th><th className="p-2 text-right">Vendas</th><th className="p-2 text-right">Média 3 meses</th><th className="p-2 text-right">Taxa</th><th className="p-2 text-right">Comissão</th><th className="p-2">Ação</th></tr>
            </thead>
            <tbody>
              {data.reps.map((rep) => {
                const result = data.commissions.find((commission) => commission.rep_id === rep.id && commission.period_month.slice(0, 7) === monthNow);
                return (
                  <tr key={rep.id} className="border-b border-border last:border-0">
                    <td className="p-2 font-medium">{rep.full_name}</td>
                    <td className="p-2 text-right">{result ? brl(result.eligible_sales) : "—"}</td>
                    <td className="p-2 text-right">{result ? brl(result.previous_three_months_average) : "—"}</td>
                    <td className="p-2 text-right">{result ? String(result.rate_pct.toFixed(2)) + "%" : "—"}</td>
                    <td className="p-2 text-right font-bold">{result ? brl(result.commission_amount) : "—"}</td>
                    <td className="p-2">
                      <button type="button" onClick={() => calculateMonth(rep.id)} disabled={calculatingRep === rep.id} className="rounded border border-border px-2 py-1 text-xs font-bold hover:bg-muted disabled:opacity-50">
                        {calculatingRep === rep.id ? "Calculando..." : "Calcular mês"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Base elegível: pedidos assistidos enviados/convertidos e vendas PDV pagas. Pedidos cancelados ficam fora.</p>
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold uppercase text-emerald-950">Crédito comercial do vendedor</h2>
            <p className="text-xs text-emerald-900/80">
              O vendedor pode vender acima do preço-base dentro do limite; o crédito líquido considera o imposto configurado.
            </p>
          </div>
          <button
            type="button"
            onClick={() => creditMutation.mutate()}
            disabled={creditMutation.isPending || creditQuery.isLoading}
            className="rounded bg-emerald-700 px-3 py-2 text-xs font-bold uppercase text-white disabled:opacity-50"
          >
            {creditMutation.isPending ? "Salvando..." : "Salvar regra"}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-xs font-bold uppercase text-emerald-950">
            Ativar crédito
            <select
              value={creditForm.enabled ? "true" : "false"}
              onChange={(event) => setCreditForm({ ...creditForm, enabled: event.target.value === "true" })}
              className={inputClass}
            >
              <option value="false">Desativado</option>
              <option value="true">Ativado</option>
            </select>
          </label>
          <label className="text-xs font-bold uppercase text-emerald-950">
            Acréscimo máximo (%)
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={creditForm.max_uplift_pct}
              onChange={(event) => setCreditForm({ ...creditForm, max_uplift_pct: Number(event.target.value) || 0 })}
              className={inputClass}
            />
          </label>
          <label className="text-xs font-bold uppercase text-emerald-950">
            Imposto sobre acréscimo (%)
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={creditForm.tax_rate_pct}
              onChange={(event) => setCreditForm({ ...creditForm, tax_rate_pct: Number(event.target.value) || 0 })}
              className={inputClass}
            />
          </label>
          <label className="text-xs font-bold uppercase text-emerald-950">
            Uso máximo do saldo (%)
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={creditForm.max_credit_use_pct}
              onChange={(event) => setCreditForm({ ...creditForm, max_credit_use_pct: Number(event.target.value) || 0 })}
              className={inputClass}
            />
          </label>
        </div>
        {creditQuery.isError ? (
          <p className="mt-3 text-sm text-destructive">Não foi possível carregar os créditos dos vendedores.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-emerald-200 text-left text-xs uppercase text-emerald-900/70">
                <tr><th className="p-2">Vendedor</th><th className="p-2">Status</th><th className="p-2 text-right">Saldo de crédito</th></tr>
              </thead>
              <tbody>
                {(creditQuery.data?.accounts ?? []).map((account) => (
                  <tr key={account.id} className="border-b border-emerald-200/70 last:border-0">
                    <td className="p-2"><div className="font-medium">{account.full_name}</div><div className="text-xs text-emerald-900/70">{account.email}</div></td>
                    <td className="p-2 text-xs">{account.active ? "Ativo" : "Inativo"}</td>
                    <td className="p-2 text-right font-bold">{brl(account.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(creditQuery.data?.accounts ?? []).length === 0 && (
              <p className="p-3 text-sm text-emerald-900/70">Nenhum vendedor cadastrado.</p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-emerald-900/70">
          Por segurança, a regra começa desativada. O valor do imposto deve ser informado conforme a orientação contábil da empresa.
        </p>
      </section>
    </div>
  );
}

function RepRow({
  rep,
  saving,
  onSave,
}: {
  rep: CommercialAdminData["reps"][number];
  saving: boolean;
  onSave: (value: { rep_id: string; max_discount_pct: number; commission_pct: number }) => void;
}) {
  const [commission, setCommission] = useState(rep.commission_pct);
  const [maxDiscount, setMaxDiscount] = useState(rep.max_discount_pct);

  useEffect(() => {
    setCommission(rep.commission_pct);
    setMaxDiscount(rep.max_discount_pct);
  }, [rep.commission_pct, rep.max_discount_pct]);

  return (
    <tr className="border-b border-border last:border-0">
      <td className="p-2"><div className="font-medium">{rep.full_name}</div><div className="text-xs text-muted-foreground">{rep.email}</div></td>
      <td className="p-2"><input type="number" min={0} max={100} step="0.01" value={commission} onChange={(event) => setCommission(Number(event.target.value) || 0)} className="w-28 rounded border border-border bg-background px-2 py-1" /></td>
      <td className="p-2"><input type="number" min={0} max={100} step="0.01" value={maxDiscount} onChange={(event) => setMaxDiscount(Number(event.target.value) || 0)} className="w-32 rounded border border-border bg-background px-2 py-1" /></td>
      <td className="p-2"><button type="button" onClick={() => onSave({ rep_id: rep.id, commission_pct: commission, max_discount_pct: maxDiscount })} disabled={saving} className="rounded bg-primary px-2 py-1 text-xs font-bold text-primary-foreground disabled:opacity-50"><Save className="inline h-3 w-3" /> Salvar</button></td>
    </tr>
  );
}
