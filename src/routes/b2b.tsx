import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CheckCircle2, Clock, XCircle, Zap, Store, Wrench, Package, CreditCard } from "lucide-react";
import { useSession } from "@/lib/session";
import {
  getMyB2BCommercialProfile,
  submitB2BRegistration,
  type B2BCommercialProfile,
} from "@/lib/b2b.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/b2b")({
  head: () => ({
    meta: [
      { title: "Compre no Atacado · Norte Sul Acessórios" },
      { name: "description", content: "Cadastre seu CNPJ e tenha tabela de atacado e condições comerciais definidas para sua empresa." },
    ],
  }),
  component: B2BPage,
});

const schema = z.object({
  cnpj: z.string().trim().min(14, "CNPJ inválido").max(20),
  razao_social: z.string().trim().min(3).max(200),
  nome_fantasia: z.string().trim().max(200).optional().or(z.literal("")),
  whatsapp: z.string().trim().min(8).max(30),
  cidade: z.string().trim().min(2).max(120),
  estado: z.string().trim().length(2).optional().or(z.literal("")),
  segmento: z.string().trim().min(2).max(120),
  volume_medio_compra: z.string().max(120).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

function B2BPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const submitRegistration = useServerFn(submitB2BRegistration);
  const loadCommercialProfile = useServerFn(getMyB2BCommercialProfile);
  const [commercial, setCommercial] = useState<B2BCommercialProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(Boolean(user));
  const [loading, setLoading] = useState(false);
  const [editingRejected, setEditingRejected] = useState(false);
  const [form, setForm] = useState<FormValues>({
    cnpj: "",
    razao_social: "",
    nome_fantasia: "",
    whatsapp: "",
    cidade: "",
    estado: "",
    segmento: "",
    volume_medio_compra: "",
  });

  async function refreshProfile() {
    if (!user) {
      setCommercial(null);
      setLoadingProfile(false);
      return;
    }
    try {
      setCommercial(await loadCommercialProfile());
    } catch (error) {
      console.error("Falha ao carregar condição comercial B2B.", error);
    } finally {
      setLoadingProfile(false);
    }
  }

  useEffect(() => {
    void refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      navigate({ to: "/auth", search: { next: "/b2b" } as never });
      return;
    }
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Verifique os dados");
      return;
    }
    setLoading(true);
    try {
      await submitRegistration({ data: parsed.data });
      toast.success("Solicitação B2B enviada para análise.");
      setEditingRejected(false);
      await refreshProfile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o cadastro B2B.");
    } finally {
      setLoading(false);
    }
  }

  const showForm = !commercial?.approved && !commercial?.pending && (!commercial?.rejected || editingRejected);

  return (
    <div>
      <section className="bg-secondary text-secondary-foreground">
        <div className="container-x grid gap-6 py-10 md:grid-cols-2 md:py-16">
          <div>
            <span className="rounded bg-primary px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">Norte Sul B2B</span>
            <h1 className="mt-3 font-display text-4xl font-black uppercase leading-tight md:text-5xl">Uma conta. Condições comerciais para sua empresa.</h1>
            <p className="mt-3 max-w-lg text-sm text-white/80 md:text-base">
              Todo cadastro começa como varejo. Depois da aprovação do CNPJ, sua própria conta passa a usar
              tabela de atacado e somente as formas de pagamento liberadas pelo comercial.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-3">
              {[
                { icon: Zap, t: "Tabela A, B ou C" },
                { icon: CreditCard, t: "Prazo por cliente" },
                { icon: Package, t: "Estoque integrado" },
              ].map((b) => (
                <div key={b.t} className="flex items-center gap-2 rounded-lg bg-white/5 p-3 text-sm">
                  <b.icon className="h-4 w-4 text-primary" /> {b.t}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-secondary-foreground backdrop-blur">
            {loadingProfile ? (
              <div className="py-10 text-center text-sm text-white/70">Carregando seu cadastro…</div>
            ) : commercial?.approved ? (
              <div>
                <div className="text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
                  <h3 className="mt-2 font-display text-xl font-bold uppercase">B2B aprovado</h3>
                  <p className="mt-1 text-sm text-white/70">Sua conta já compra com a condição comercial aprovada.</p>
                </div>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <Info label="Tabela de preço" value={`Tabela ${commercial.priceTable ?? "C"}`} />
                  <Info label="Perfil" value={groupLabel(commercial.customerGroup)} />
                  <Info
                    label="Boleto"
                    value={commercial.allowedBoletoDays.length
                      ? commercial.allowedBoletoDays.map((d) => `${d} dias`).join(", ")
                      : "Não liberado"}
                  />
                  <Info label="Cartão" value={`Até ${commercial.maxCardInstallments}x`} />
                  <Info
                    label="Faturado"
                    value={commercial.allowInvoice ? `${commercial.invoiceDueDays} dias` : "Não liberado"}
                  />
                  <Info label="Regra" value="Preço validado no servidor" />
                </div>
                <Link to="/catalogo" className="mt-5 block rounded-md bg-primary px-6 py-3 text-center text-sm font-bold uppercase text-primary-foreground">
                  Comprar com minha tabela
                </Link>
              </div>
            ) : commercial?.pending ? (
              <div className="text-center">
                <Clock className="mx-auto h-10 w-10 text-hot" />
                <h3 className="mt-2 font-display text-xl font-bold uppercase">Cadastro em análise</h3>
                <p className="mt-2 text-sm text-white/70">
                  Enquanto a análise não for concluída, sua conta continua comprando normalmente como B2C.
                  Nenhum preço ou prazo B2B é liberado antes da aprovação.
                </p>
                <Link to="/catalogo" className="mt-4 inline-block rounded-md border border-white/20 px-5 py-2.5 text-sm font-bold">
                  Continuar no varejo
                </Link>
              </div>
            ) : commercial?.rejected && !editingRejected ? (
              <div className="text-center">
                <XCircle className="mx-auto h-10 w-10 text-destructive" />
                <h3 className="mt-2 font-display text-xl font-bold uppercase">Cadastro não aprovado</h3>
                <p className="mt-2 text-sm text-white/70">
                  Sua conta continua disponível para compras no varejo. Você pode revisar os dados e enviar uma nova solicitação.
                </p>
                <button onClick={() => setEditingRejected(true)} className="mt-4 rounded-md bg-primary px-5 py-2.5 text-sm font-bold uppercase text-primary-foreground">
                  Revisar e reenviar
                </button>
              </div>
            ) : showForm ? (
              <form onSubmit={submit} className="space-y-3">
                <h3 className="font-display text-lg font-bold uppercase">Solicite sua condição B2B</h3>
                <Grid>
                  <F label="CNPJ"><input required value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} className={inp} /></F>
                  <F label="WhatsApp"><input required value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} className={inp} /></F>
                </Grid>
                <F label="Razão social"><input required value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value })} className={inp} /></F>
                <F label="Nome fantasia"><input value={form.nome_fantasia ?? ""} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })} className={inp} /></F>
                <Grid>
                  <F label="Cidade"><input required value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} className={inp} /></F>
                  <F label="UF"><input maxLength={2} value={form.estado ?? ""} onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })} className={inp} /></F>
                </Grid>
                <F label="Segmento">
                  <select required value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })} className={inp}>
                    <option value="">Selecione…</option>
                    <option>Loja de acessórios</option>
                    <option>Oficina mecânica</option>
                    <option>Instalador</option>
                    <option>Revendedor / distribuidor</option>
                    <option>Concessionária</option>
                    <option>Outro</option>
                  </select>
                </F>
                <F label="Volume médio de compra mensal">
                  <select value={form.volume_medio_compra ?? ""} onChange={(e) => setForm({ ...form, volume_medio_compra: e.target.value })} className={inp}>
                    <option value="">Selecione…</option>
                    <option>Até R$ 2.000</option>
                    <option>R$ 2.000 – R$ 10.000</option>
                    <option>R$ 10.000 – R$ 30.000</option>
                    <option>Mais de R$ 30.000</option>
                  </select>
                </F>
                <button disabled={loading} className="mt-2 w-full rounded-md bg-primary px-4 py-3 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110 disabled:opacity-60">
                  {loading ? "Enviando…" : "Enviar para análise"}
                </button>
                {!user && <p className="text-center text-[10px] text-white/60">Você entrará na sua conta antes de enviar.</p>}
              </form>
            ) : null}
          </div>
        </div>
      </section>

      <section className="container-x mt-10 grid gap-3 md:grid-cols-3">
        {[
          { icon: Zap, t: "Preço correto por cliente", d: "Tabela A, B ou C e preços específicos por produto são respeitados no servidor." },
          { icon: Wrench, t: "Cadastro único", d: "A mesma conta funciona no varejo e, após aprovação, recebe os benefícios B2B." },
          { icon: Store, t: "Crédito controlado", d: "Boleto e faturado aparecem somente nos prazos que o comercial liberou." },
        ].map((b) => (
          <div key={b.t} className="rounded-lg border border-border bg-card p-5">
            <b.icon className="h-6 w-6 text-primary" />
            <h4 className="mt-2 font-display text-lg font-bold uppercase">{b.t}</h4>
            <p className="text-sm text-muted-foreground">{b.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function groupLabel(group: B2BCommercialProfile["customerGroup"]) {
  if (group === "oficina") return "Oficina";
  if (group === "revendedor") return "Revendedor";
  if (group === "distribuidor") return "Distribuidor";
  return "Cliente";
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-white/5 p-3"><div className="text-[10px] font-bold uppercase text-white/50">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div>;
}

const inp = "w-full rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/50 outline-none focus:border-primary";
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase text-white/70">{label}</span>{children}</label>;
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
