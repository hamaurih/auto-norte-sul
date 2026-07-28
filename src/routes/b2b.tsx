import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { z } from "zod";
import { CheckCircle2, Clock, XCircle, Zap, Store, Wrench, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { toast } from "sonner";

export const Route = createFileRoute("/b2b")({
  head: () => ({
    meta: [
      { title: "Compre no Atacado · Norte Sul Acessórios" },
      { name: "description", content: "Cadastre seu CNPJ e ganhe acesso à tabela de preços de atacado, condição faturada e catálogo completo." },
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
  const { user, isB2BApproved } = useSession();
  const navigate = useNavigate();
  const [existing, setExisting] = useState<{ status: string; created_at: string } | null>(null);
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    if (!user) return;
    supabase.from("b2b_registrations").select("status, created_at").eq("user_id", user.id).maybeSingle().then(({ data }) => setExisting(data));
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
    const { error } = await supabase.from("b2b_registrations").insert({
      user_id: user.id,
      ...parsed.data,
      nome_fantasia: parsed.data.nome_fantasia || null,
      estado: parsed.data.estado || null,
      volume_medio_compra: parsed.data.volume_medio_compra || null,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Cadastro enviado! Nossa equipe analisa em até 1 dia útil.");
    setExisting({ status: "pendente", created_at: new Date().toISOString() });
  }

  return (
    <div>
      {/* Hero */}
      <section className="bg-secondary text-secondary-foreground">
        <div className="container-x grid gap-6 py-10 md:grid-cols-2 md:py-16">
          <div>
            <span className="rounded bg-primary px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">Norte Sul B2B</span>
            <h1 className="mt-3 font-display text-4xl font-black uppercase leading-tight md:text-5xl">Compre no atacado com quem entende de automotivo</h1>
            <p className="mt-3 max-w-lg text-sm text-white/80 md:text-base">
              Somos parceiros de lojistas, oficinas, instaladores e revendedores em todo o Brasil.
              Preço especial, catálogo completo e condições exclusivas.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-3">
              {[
                { icon: Zap, t: "Preço atacado" },
                { icon: Store, t: "Faturado 28d" },
                { icon: Package, t: "Envio nacional" },
              ].map((b) => (
                <div key={b.t} className="flex items-center gap-2 rounded-lg bg-white/5 p-3 text-sm">
                  <b.icon className="h-4 w-4 text-primary" /> {b.t}
                </div>
              ))}
            </div>
          </div>

          {/* Form / status */}
          <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-secondary-foreground backdrop-blur">
            {isB2BApproved ? (
              <div className="text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
                <h3 className="mt-2 font-display text-xl font-bold uppercase">Cadastro aprovado</h3>
                <p className="mt-1 text-sm text-white/70">Você já está vendo os preços de atacado no catálogo.</p>
                <Link to="/catalogo" className="mt-4 inline-block rounded-md bg-primary px-6 py-3 text-sm font-bold uppercase text-primary-foreground">
                  Ir para o catálogo
                </Link>
              </div>
            ) : existing ? (
              <div className="text-center">
                {existing.status === "pendente" && <Clock className="mx-auto h-10 w-10 text-hot" />}
                {existing.status === "aprovado" && <CheckCircle2 className="mx-auto h-10 w-10 text-success" />}
                {existing.status === "reprovado" && <XCircle className="mx-auto h-10 w-10 text-destructive" />}
                <h3 className="mt-2 font-display text-xl font-bold uppercase">
                  {existing.status === "pendente" && "Cadastro em análise"}
                  {existing.status === "aprovado" && "Cadastro aprovado"}
                  {existing.status === "reprovado" && "Cadastro reprovado"}
                </h3>
                <p className="mt-1 text-sm text-white/70">
                  {existing.status === "pendente" && "Sua solicitação foi recebida. Retornamos em até 1 dia útil."}
                  {existing.status === "aprovado" && "Você já pode comprar com preços de atacado."}
                  {existing.status === "reprovado" && "Fale com nosso comercial pelo WhatsApp para mais informações."}
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <h3 className="font-display text-lg font-bold uppercase">Solicite seu cadastro B2B</h3>
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
                  {loading ? "Enviando…" : "Enviar solicitação"}
                </button>
                {!user && <p className="text-center text-[10px] text-white/60">Você precisará entrar antes de enviar.</p>}
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="container-x mt-10 grid gap-3 md:grid-cols-3">
        {[
          { icon: Zap, t: "Preço de atacado", d: "Tabela especial liberada após aprovação do CNPJ." },
          { icon: Wrench, t: "Suporte técnico", d: "Time comercial pronto para tirar dúvidas de aplicação e instalação." },
          { icon: Store, t: "Catálogo revenda", d: "Fotos, descrições e SKU prontos para uso na sua loja." },
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

const inp = "w-full rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/50 outline-none focus:border-primary";
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase text-white/70">{label}</span>
      {children}
    </label>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
