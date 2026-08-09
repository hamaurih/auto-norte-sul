import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CheckCircle2, Copy, Mail, ShieldCheck, XCircle } from "lucide-react";
import {
  activeTenant,
  environmentLabel,
  fetchAccessContext,
  isOrganizationAdmin,
  isLegacyStaff,
  useAccessContext,
} from "@/lib/access";
import { createInvitation, listInvitations, revokeInvitation } from "@/lib/access.functions";
import { useCompanyProfile } from "@/lib/company";
import { setActiveTenantSlug } from "@/integrations/supabase/tenant";

export const Route = createFileRoute("/_authenticated/admin/homologacao")({
  head: () => ({ meta: [{ title: "Homologação de acesso · Admin" }] }),
  beforeLoad: async () => {
    // Owner/admin of the organization only. Membership decides, never metadata.
    const context = await fetchAccessContext();
    if (!context.user_id) throw redirect({ to: "/auth" });
    const legacyStaff = await isLegacyStaff(context.user_id);
    if (context.organizations.length === 0 && context.tenants.length === 0) {
      if (!legacyStaff) throw redirect({ to: "/ativacao" });
      return;
    }
    const privileged =
      legacyStaff ||
      isOrganizationAdmin(context) ||
      context.tenants.some((tenant: { role: string }) => tenant.role === "owner" || tenant.role === "admin");
    if (!privileged) throw redirect({ to: "/admin" });
  },
  component: HomologationPage,
});


function HomologationPage() {
  const { data: context, isLoading } = useAccessContext();
  const { data: company } = useCompanyProfile();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const admin = isOrganizationAdmin(context);
  const organization = context?.organizations[0];
  const tenant = activeTenant(context);

  const invitations = useQuery({
    queryKey: ["invitations"],
    queryFn: () => listInvitations(),
    enabled: admin,
  });

  const invite = useMutation({
    mutationFn: (value: string) =>
      createInvitation({ data: { email: value, organization_role: "admin", tenant_role: "admin" } }),
    onSuccess: async (result) => {
      setIssuedToken(result.token);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Convite criado. Copie o link agora — ele não será exibido novamente.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["invitations"] });
      toast.success("Convite revogado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando homologação…</p>;

  const checks = [
    { label: "Usuário autenticado", ok: Boolean(context?.user_id), detail: context?.email ?? "—" },
    {
      label: "Organização vinculada",
      ok: Boolean(organization),
      detail: organization ? `${organization.trade_name ?? organization.slug} · ${organization.role}` : "sem vínculo",
    },
    {
      label: "Tenant ativo autorizado",
      ok: Boolean(tenant),
      detail: tenant ? `${tenant.name} · ${environmentLabel[tenant.environment] ?? tenant.environment}` : "não autorizado",
    },
    { label: "Papel no tenant", ok: Boolean(tenant?.role), detail: tenant?.role ?? "—" },
    {
      label: "Storefront ativo",
      ok: Boolean(tenant?.storefront_active),
      detail: tenant?.storefront_slug ?? "não configurado",
    },
    {
      label: "Perfil da empresa",
      ok: Boolean(company?.trade_name),
      detail: company?.trade_name ?? "não preenchido",
    },
    {
      label: "Ambientes disponíveis",
      ok: (context?.tenants.length ?? 0) > 0,
      detail: (context?.tenants ?? []).map((item) => environmentLabel[item.environment] ?? item.environment).join(", ") || "nenhum",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold uppercase">Homologação de acesso</h1>
        <p className="text-sm text-muted-foreground">
          Diagnóstico somente leitura do vínculo entre usuário, organização e ambiente ativo.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-bold uppercase">
          <ShieldCheck className="h-5 w-5 text-primary" /> Requisitos
        </h2>
        <ul className="space-y-2">
          {checks.map((check) => (
            <li key={check.label} className="flex items-start gap-3 border-b border-border/60 pb-2 text-sm last:border-0">
              {check.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
              )}
              <span className="font-semibold">{check.label}</span>
              <span className="ml-auto text-muted-foreground">{check.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold uppercase">
          <Building2 className="h-5 w-5 text-primary" /> Ambientes autorizados
        </h2>
        <div className="flex flex-wrap gap-2">
          {(context?.tenants ?? []).map((item) => (
            <button
              key={item.id}
              onClick={() => item.storefront_slug && setActiveTenantSlug(item.storefront_slug)}
              disabled={!item.storefront_slug || item.id === tenant?.id}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold disabled:bg-muted disabled:opacity-70"
            >
              {environmentLabel[item.environment] ?? item.environment} · {item.role}
              {item.id === tenant?.id ? " (ativo)" : ""}
            </button>
          ))}
          {(context?.tenants.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum ambiente autorizado para este usuário.</p>
          )}
        </div>
        <Link to="/admin/configuracoes" className="mt-4 inline-flex text-sm font-semibold text-primary underline">
          Abrir Empresa e identidade visual
        </Link>
      </section>

      {admin && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold uppercase">
            <Mail className="h-5 w-5 text-primary" /> Convites de acesso
          </h2>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim()) invite.mutate(email);
            }}
          >
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="email@empresa.com.br"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={invite.isPending || !email.trim()}
              className="rounded-md bg-primary px-5 py-2 text-sm font-bold uppercase text-primary-foreground disabled:opacity-50"
            >
              {invite.isPending ? "Gerando…" : "Convidar"}
            </button>
          </form>

          {issuedToken && (
            <div className="mt-3 rounded-md border border-dashed border-primary/50 p-3 text-xs">
              <p className="mb-2 font-semibold uppercase text-muted-foreground">
                Link de ativação (exibido apenas uma vez)
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate">{`${window.location.origin}/ativacao?token=${issuedToken}`}</code>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(`${window.location.origin}/ativacao?token=${issuedToken}`);
                    toast.success("Link copiado.");
                  }}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 font-semibold"
                >
                  <Copy className="h-3 w-3" /> Copiar
                </button>
              </div>
            </div>
          )}

          <ul className="mt-4 space-y-2 text-sm">
            {(invitations.data ?? []).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2 last:border-0">
                <span className="font-semibold">{item.email}</span>
                <span className="text-xs uppercase text-muted-foreground">
                  {item.organization_role} · expira {new Date(item.expires_at).toLocaleDateString("pt-BR")}
                </span>
                <span className="ml-auto text-xs font-semibold uppercase">
                  {item.accepted_at ? "aceito" : item.revoked_at ? "revogado" : "pendente"}
                </span>
                {!item.accepted_at && !item.revoked_at && (
                  <button
                    onClick={() => revoke.mutate(item.id)}
                    className="rounded border border-border px-2 py-1 text-xs font-semibold"
                  >
                    Revogar
                  </button>
                )}
              </li>
            ))}
            {invitations.data?.length === 0 && (
              <li className="text-sm text-muted-foreground">Nenhum convite emitido.</li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
