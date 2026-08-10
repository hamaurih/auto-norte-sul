import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth-errors";
import { toast } from "sonner";

export const Route = createFileRoute("/esqueci-senha")({
  head: () => ({
    meta: [
      { title: "Recuperar senha · Norte Sul Acessórios" },
      { name: "description", content: "Solicite um link seguro para redefinir a senha da sua conta Norte Sul Acessórios." },
      { property: "og:title", content: "Recuperar senha · Norte Sul Acessórios" },
      { property: "og:description", content: "Solicite um link seguro para redefinir a senha da sua conta." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPasswordPage,
});

const emailSchema = z.string().trim().email().max(255);

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });
      // Resposta genérica: nunca revelar se o e-mail existe.
      if (error && /rate limit|too many|for security purposes/i.test(error.message)) {
        toast.error(authErrorMessage(error));
      } else {
        setSent(true);
      }
    } catch (err) {
      toast.error(authErrorMessage(err));
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
        <h1 className="font-display text-2xl font-bold uppercase">Recuperar senha</h1>

        {sent ? (
          <div className="mt-4 space-y-4">
            <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
              Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha. Verifique também a caixa de spam.
            </p>
            <Link to="/auth" className="block w-full rounded-md bg-primary px-4 py-2.5 text-center text-sm font-bold uppercase text-primary-foreground hover:brightness-110">
              Voltar para o login
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.
            </p>
            <form onSubmit={submit} className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase">Email</span>
                <input
                  type="email"
                  required
                  maxLength={255}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <button disabled={loading} className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110 disabled:opacity-60">
                {loading ? "Enviando…" : "Enviar link de recuperação"}
              </button>
            </form>
            <p className="mt-4 text-center text-sm">
              <Link to="/auth" className="font-semibold text-primary hover:underline">Voltar para o login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
