import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth-errors";
import { toast } from "sonner";

export const Route = createFileRoute("/redefinir-senha")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Definir nova senha · Norte Sul Acessórios" },
      { name: "description", content: "Crie uma nova senha para acessar sua conta Norte Sul Acessórios com segurança." },
      { property: "og:title", content: "Definir nova senha · Norte Sul Acessórios" },
      { property: "og:description", content: "Crie uma nova senha para acessar sua conta com segurança." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

type Status = "checking" | "ready" | "invalid" | "done";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) setStatus("ready");
    });

    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const hasRecoveryHash = /type=recovery/.test(hash) || /access_token=/.test(hash);
    const hasErrorHash = /error=/.test(hash);

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) setStatus("ready");
      else if (hasRecoveryHash && !hasErrorHash) setStatus("checking");
      else setStatus("invalid");
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("A senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Encerra as demais sessões do usuário quando suportado pelo backend.
      try {
        await supabase.auth.signOut({ scope: "others" });
      } catch {
        /* backend pode não suportar; senha já foi atualizada */
      }
      await supabase.auth.signOut();

      setStatus("done");
      toast.success("Senha atualizada com sucesso. Entre com a nova senha.");
      setTimeout(() => navigate({ to: "/auth", replace: true }), 1500);
    } catch (err) {
      toast.error(authErrorMessage(err, "Não foi possível atualizar a senha."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-6 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary font-display text-lg font-black text-primary-foreground">NS</div>
          <div className="font-display text-lg font-bold uppercase">Norte Sul</div>
        </Link>
        <h1 className="font-display text-2xl font-bold uppercase">Nova senha</h1>

        {status === "checking" && (
          <p className="mt-4 text-sm text-muted-foreground">Validando seu link de recuperação…</p>
        )}

        {status === "invalid" && (
          <div className="mt-4 space-y-4">
            <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
              Este link de recuperação é inválido ou expirou. Solicite um novo link para redefinir sua senha.
            </p>
            <Link to="/esqueci-senha" className="block w-full rounded-md bg-primary px-4 py-2.5 text-center text-sm font-bold uppercase text-primary-foreground hover:brightness-110">
              Solicitar novo link
            </Link>
          </div>
        )}

        {status === "done" && (
          <div className="mt-4 space-y-4">
            <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
              Senha atualizada. Encaminhando para o login…
            </p>
            <Link to="/auth" className="block w-full rounded-md bg-primary px-4 py-2.5 text-center text-sm font-bold uppercase text-primary-foreground hover:brightness-110">
              Ir para o login
            </Link>
          </div>
        )}

        {status === "ready" && (
          <>
            <p className="text-sm text-muted-foreground">Escolha uma senha com no mínimo 8 caracteres.</p>
            <form onSubmit={submit} className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase">Nova senha</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase">Confirmar senha</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <button disabled={loading} className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110 disabled:opacity-60">
                {loading ? "Salvando…" : "Salvar nova senha"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
