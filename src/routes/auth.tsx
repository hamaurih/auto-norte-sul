import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";

const search = z.object({ next: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Entrar · Norte Sul" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function redirectAfterAuth(userId: string) {
    if (next) {
      navigate({ to: next as never });
      return;
    }
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isStaff = (roles ?? []).some((r) => r.role === "admin" || r.role === "gerente");
    const isVendedor = (roles ?? []).some((r) => r.role === "vendedor");
    if (isStaff) navigate({ to: "/admin" });
    else if (isVendedor) navigate({ to: "/vendedor" });
    else navigate({ to: "/" });
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) redirectAfterAuth(data.session.user.id);
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("Conta criada! Você já pode navegar.");
        if (data.user) await redirectAfterAuth(data.user.id);
        else navigate({ to: "/" });
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bem-vindo(a) de volta!");
        if (data.user) await redirectAfterAuth(data.user.id);
        else navigate({ to: "/" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na autenticação");
    } finally {
      setLoading(false);
    }
  }


  async function google() {
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      navigate({ to: (next as never) ?? "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no login Google");
    }
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      {/* Left visual */}
      <div className="relative hidden bg-gradient-to-br from-secondary to-primary md:block">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "url(https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&auto=format&fit=crop)", backgroundSize: "cover", backgroundPosition: "center" }} />
        <div className="relative z-10 flex h-full flex-col justify-between p-10 text-white">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-primary font-display text-lg font-black">NS</div>
            <div>
              <div className="font-display text-lg font-bold uppercase leading-none">Norte Sul</div>
              <div className="text-[10px] uppercase tracking-widest opacity-70">Acessórios</div>
            </div>
          </Link>
          <div>
            <h2 className="font-display text-4xl font-black uppercase leading-tight">Turbine seu carro. Simplifique sua loja.</h2>
            <p className="mt-2 max-w-sm text-sm opacity-80">Acesso ao catálogo completo, preço atacado (B2B) e integração com o seu Bling.</p>
          </div>
        </div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-6 flex items-center gap-2 md:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary font-display text-lg font-black text-primary-foreground">NS</div>
            <div className="font-display text-lg font-bold uppercase">Norte Sul</div>
          </Link>
          <h1 className="font-display text-2xl font-bold uppercase">
            {mode === "login" ? "Entrar" : "Criar conta"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "login" ? "Bem-vindo(a) de volta." : "Cadastro rápido para comprar."}
          </p>

          <button
            onClick={google}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" /></svg>
            Continuar com Google
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> ou <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase">Nome</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase">Senha</span>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </label>
            <button disabled={loading} className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110 disabled:opacity-60">
              {loading ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>

          <p className="mt-4 text-center text-sm">
            {mode === "login" ? (
              <>Não tem conta?{" "}<button onClick={() => setMode("signup")} className="font-semibold text-primary hover:underline">Cadastre-se</button></>
            ) : (
              <>Já tem conta?{" "}<button onClick={() => setMode("login")} className="font-semibold text-primary hover:underline">Entrar</button></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
