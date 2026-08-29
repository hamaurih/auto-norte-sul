import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, MailCheck, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { tdb } from "@/integrations/supabase/tenant-db";
import { hasAnyMembership, useAccessContext } from "@/lib/access";

export const Route = createFileRoute("/ativacao")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ativação de acesso · Norte Sul Auto Hub" },
      {
        name: "description",
        content:
          "Conclua a ativação do seu acesso administrativo ao Norte Sul Auto Hub com o convite recebido do proprietário da conta.",
      },
      { property: "og:title", content: "Ativação de acesso · Norte Sul Auto Hub" },
      {
        property: "og:description",
        content: "Use o convite de uso único para vincular sua conta à organização.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === "string" ? { token: search.token } : {},
  component: ActivationPage,
});

function ActivationPage() {
  const { token: tokenFromUrl } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: context, isLoading } = useAccessContext();
  const [token, setToken] = useState("");

  useEffect(() => {
    if (!tokenFromUrl) return;
    setToken(tokenFromUrl);
    // Remove o token da URL para não ficar no histórico/referrer.
    void navigate({ to: "/ativacao", search: () => ({}), replace: true });
  }, [tokenFromUrl, navigate]);


  useEffect(() => {
    if (!isLoading && context && !context.user_id) {
      void navigate({ to: "/auth" });
    }
  }, [isLoading, context, navigate]);

  const accept = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await tdb(supabase).rpc("accept_tenant_invitation", { p_token: value.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["access-context"] });
      toast.success("Acesso ativado com sucesso.");
      void navigate({ to: "/admin/homologacao" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) {
    return <p className="p-8 text-sm text-muted-foreground">Verificando seu acesso…</p>;
  }

  const linked = hasAnyMembership(context);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-12">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-bold uppercase">Ativação de acesso</h1>
        <p className="text-sm text-muted-foreground">
          Sua conta <strong>{context?.email}</strong> está autenticada, mas o acesso administrativo
          depende de um convite emitido pelo proprietário da organização.
        </p>
      </header>

      {linked ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold uppercase">
            <ShieldCheck className="h-5 w-5 text-primary" /> Acesso já vinculado
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Sua conta já possui vínculo com a organização.
          </p>
          <Link
            to="/admin"
            className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground"
          >
            Ir para o painel
          </Link>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold uppercase">
              <MailCheck className="h-5 w-5 text-primary" /> Ativação pendente
            </h2>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>O proprietário ou administrador emite um convite para o seu e-mail.</li>
              <li>O convite é de uso único, expira em 7 dias e vale apenas para este e-mail.</li>
              <li>Cole o código abaixo ou abra o link recebido para concluir a ativação.</li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Nenhum acesso é concedido automaticamente, mesmo para o primeiro usuário cadastrado.
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold uppercase">
              <KeyRound className="h-5 w-5 text-primary" /> Tenho um convite
            </h2>
            <form
              className="mt-3 flex flex-col gap-3 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (token.trim()) accept.mutate(token);
              }}
            >
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Código do convite"
                autoComplete="off"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={accept.isPending || !token.trim()}
                className="rounded-md bg-primary px-5 py-2 text-sm font-bold uppercase text-primary-foreground disabled:opacity-50"
              >
                {accept.isPending ? "Ativando…" : "Ativar"}
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
