import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth-errors";
import { completeFirstAccess } from "@/lib/auth.functions";

export const Route = createFileRoute("/primeiro-acesso")({
  ssr: false,
  head: () => ({ meta: [{ title: "Primeiro acesso · Norte Sul" }] }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
  },
  component: FirstAccessPage,
});

function FirstAccessPage() {
  const navigate = useNavigate();
  const finishFirstAccess = useServerFn(completeFirstAccess);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      if (!data.user) {
        void navigate({ to: "/auth", replace: true });
        return;
      }
      if (data.user.app_metadata?.must_change_password !== true) {
        void navigate({ to: "/admin", replace: true });
        return;
      }
      setChecking(false);
    });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("A nova senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não coincidem.");
      return;
    }

    setSaving(true);
    try {
      await finishFirstAccess({ data: { password } });
      await supabase.auth.refreshSession();
      toast.success("Senha alterada. Bem-vindo ao sistema.");
      await navigate({ to: "/admin", replace: true });
    } catch (error) {
      toast.error(authErrorMessage(error, "Não foi possível concluir o primeiro acesso."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <Link to="/" className="mb-6 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary font-display text-lg font-black text-primary-foreground">NS</div>
          <div className="font-display text-lg font-bold uppercase">Norte Sul</div>
        </Link>
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h1 className="font-display text-2xl font-bold uppercase text-amber-950">Primeiro acesso</h1>
          <p className="mt-1 text-sm text-amber-900">
            Por segurança, crie uma nova senha para continuar. A senha provisória não poderá mais ser usada depois desta troca.
          </p>
        </div>

        {checking ? (
          <p className="text-sm text-muted-foreground">Validando acesso…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase">Nova senha</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase">Confirmar nova senha</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <button
              disabled={saving || password.length < 8 || password !== confirm}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110 disabled:opacity-60"
            >
              {saving ? "Salvando…" : "Criar minha nova senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
