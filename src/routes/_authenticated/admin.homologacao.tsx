import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Copy,
  Mail,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { setActiveTenantSlug } from "@/integrations/supabase/tenant";

type TestStatus = "approved" | "failed" | "blocked" | "retest";
type Criticality = "critical" | "high" | "medium" | "low";

type HomologationCase = {
  id: string;
  tenant_id: string;
  code: string;
  sector: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  steps: unknown;
  expected_result: string;
  criticality: Criticality;
  active: boolean;
  sort_order: number;
};

type HomologationRun = {
  id: string;
  tenant_id: string;
  test_case_id: string;
  status: TestStatus;
  evidence_url: string | null;
  evidence_notes: string | null;
  executed_by: string;
  executed_at: string;
};

type ReleaseAcceptance = {
  id: string;
  tenant_id: string;
  release_name: string;
  release_version: string | null;
  decision: "accepted" | "rejected";
  statement: string;
  accepted_by: string;
  accepted_at: string;
};

const statusLabel: Record<TestStatus, string> = {
  approved: "Aprovado",
  failed: "Falhou",
  blocked: "Bloqueado",
  retest: "Reteste",
};

const criticalityLabel: Record<Criticality, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
};

function dbTable(name: string) {
  return supabase.from(name as never) as any;
}

export const Route = createFileRoute("/_authenticated/admin/homologacao")({
  head: () => ({ meta: [{ title: "Homologação controlada · Admin" }] }),
  beforeLoad: async () => {
    const context = await fetchAccessContext();
    if (!context.user_id) throw redirect({ to: "/auth" });
    const legacyStaff = await isLegacyStaff(context.user_id);
    if (context.organizations.length === 0 && context.tenants.length === 0) {
      if (!legacyStaff) throw redirect({ to: "/ativacao" });
      return;
    }
    if (!legacyStaff && context.tenants.length === 0) throw redirect({ to: "/admin" });
  },
  component: HomologationPage,
});

function HomologationPage() {
  const { data: context, isLoading } = useAccessContext();
  const { data: company } = useCompanyProfile();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState("");
  const [runStatus, setRunStatus] = useState<TestStatus>("approved");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [releaseName, setReleaseName] = useState("Go-live Norte Sul");
  const [releaseVersion, setReleaseVersion] = useState("");
  const [releaseDecision, setReleaseDecision] = useState<"accepted" | "rejected">("accepted");
  const [releaseStatement, setReleaseStatement] = useState("");
  const [caseCode, setCaseCode] = useState("");
  const [caseSector, setCaseSector] = useState("");
  const [caseTitle, setCaseTitle] = useState("");
  const [caseExpected, setCaseExpected] = useState("");
  const [caseCriticality, setCaseCriticality] = useState<Criticality>("medium");

  const organizationAdmin = isOrganizationAdmin(context);
  const organization = context?.organizations[0];
  const tenant = activeTenant(context);
  const canManageHomologation =
    organizationAdmin || Boolean(tenant && ["owner", "admin", "manager"].includes(tenant.role));

  const invitations = useQuery({
    queryKey: ["invitations"],
    queryFn: () => listInvitations(),
    enabled: organizationAdmin,
  });

  const cases = useQuery({
    queryKey: ["homologation-cases", tenant?.id],
    enabled: Boolean(tenant?.id),
    queryFn: async () => {
      const { data, error } = await dbTable("homologation_test_cases")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .eq("active", true)
        .order("sort_order")
        .order("code");
      if (error) throw error;
      return (data ?? []) as HomologationCase[];
    },
  });

  const runs = useQuery({
    queryKey: ["homologation-runs", tenant?.id],
    enabled: Boolean(tenant?.id),
    queryFn: async () => {
      const { data, error } = await dbTable("homologation_test_runs")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("executed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HomologationRun[];
    },
  });

  const acceptances = useQuery({
    queryKey: ["homologation-acceptances", tenant?.id],
    enabled: Boolean(tenant?.id),
    queryFn: async () => {
      const { data, error } = await dbTable("homologation_release_acceptances")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("accepted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReleaseAcceptance[];
    },
  });

  const latestRunByCase = useMemo(() => {
    const map = new Map<string, HomologationRun>();
    for (const run of runs.data ?? []) {
      if (!map.has(run.test_case_id)) map.set(run.test_case_id, run);
    }
    return map;
  }, [runs.data]);

  const summary = useMemo(() => {
    const base = { approved: 0, failed: 0, blocked: 0, retest: 0, notRun: 0, criticalOpen: 0 };
    for (const test of cases.data ?? []) {
      const latest = latestRunByCase.get(test.id);
      if (!latest) base.notRun += 1;
      else base[latest.status] += 1;
      if (test.criticality === "critical" && latest?.status !== "approved") base.criticalOpen += 1;
    }
    return base;
  }, [cases.data, latestRunByCase]);

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

  const registerRun = useMutation({
    mutationFn: async () => {
      if (!tenant?.id || !selectedCase) throw new Error("Selecione um caso de teste.");
      const { error } = await dbTable("homologation_test_runs").insert({
        tenant_id: tenant.id,
        test_case_id: selectedCase,
        status: runStatus,
        evidence_url: evidenceUrl.trim() || null,
        evidence_notes: evidenceNotes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setEvidenceUrl("");
      setEvidenceNotes("");
      await queryClient.invalidateQueries({ queryKey: ["homologation-runs", tenant?.id] });
      toast.success("Execução registrada com histórico e responsável.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createCase = useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("Ambiente não selecionado.");
      if (!caseCode.trim() || !caseSector.trim() || !caseTitle.trim() || !caseExpected.trim()) {
        throw new Error("Preencha código, setor, título e resultado esperado.");
      }
      const { error } = await dbTable("homologation_test_cases").insert({
        tenant_id: tenant.id,
        code: caseCode.trim().toUpperCase(),
        sector: caseSector.trim(),
        title: caseTitle.trim(),
        expected_result: caseExpected.trim(),
        criticality: caseCriticality,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setCaseCode("");
      setCaseSector("");
      setCaseTitle("");
      setCaseExpected("");
      setCaseCriticality("medium");
      await queryClient.invalidateQueries({ queryKey: ["homologation-cases", tenant?.id] });
      toast.success("Caso de teste adicionado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recordAcceptance = useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("Ambiente não selecionado.");
      if (!releaseName.trim() || !releaseStatement.trim()) {
        throw new Error("Informe o nome da release e a declaração de aceite.");
      }
      const { error } = await dbTable("homologation_release_acceptances").insert({
        tenant_id: tenant.id,
        release_name: releaseName.trim(),
        release_version: releaseVersion.trim() || null,
        decision: releaseDecision,
        statement: releaseStatement.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setReleaseStatement("");
      await queryClient.invalidateQueries({ queryKey: ["homologation-acceptances", tenant?.id] });
      toast.success("Decisão formal registrada.");
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
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold uppercase">Homologação controlada</h1>
        <p className="text-sm text-muted-foreground">
          Execução auditável por setor, evidências, responsável, reteste e aceite formal de release.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-bold uppercase">
          <ShieldCheck className="h-5 w-5 text-primary" /> Requisitos de acesso
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

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold uppercase">
              <ClipboardList className="h-5 w-5 text-primary" /> Roteiros e execução
            </h2>
            <p className="text-sm text-muted-foreground">
              O status atual é sempre a execução mais recente; o histórico anterior permanece preservado.
            </p>
          </div>
          {tenant?.environment === "production" && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-bold uppercase text-amber-700">
              Produção — não execute testes destrutivos
            </span>
          )}
        </div>

        <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Aprovados", summary.approved],
            ["Falharam", summary.failed],
            ["Bloqueados", summary.blocked],
            ["Reteste", summary.retest],
            ["Não executados", summary.notRun],
            ["Críticos abertos", summary.criticalOpen],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-border bg-background p-3">
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-xs uppercase text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          {(cases.data ?? []).map((test) => {
            const latest = latestRunByCase.get(test.id);
            return (
              <article key={test.id} className="rounded-lg border border-border bg-background p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-muted-foreground">{test.code}</span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">{test.sector}</span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">
                        {criticalityLabel[test.criticality]}
                      </span>
                    </div>
                    <h3 className="mt-2 font-semibold">{test.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{test.expected_result}</p>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-bold">{latest ? statusLabel[latest.status] : "Não executado"}</div>
                    {latest && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(latest.executed_at).toLocaleString("pt-BR")}
                      </div>
                    )}
                  </div>
                </div>
                {latest?.evidence_notes && (
                  <p className="mt-3 rounded-md bg-muted/60 p-2 text-xs">Evidência: {latest.evidence_notes}</p>
                )}
                {latest?.evidence_url && (
                  <a
                    href={latest.evidence_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex text-xs font-semibold text-primary underline"
                  >
                    Abrir evidência
                  </a>
                )}
              </article>
            );
          })}
          {!cases.isLoading && (cases.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum roteiro cadastrado neste ambiente. Os roteiros iniciais foram criados no tenant de demonstração.
            </p>
          )}
        </div>

        <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
          <h3 className="mb-3 font-semibold uppercase">Registrar execução</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              value={selectedCase}
              onChange={(event) => setSelectedCase(event.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Selecione o caso de teste</option>
              {(cases.data ?? []).map((test) => (
                <option key={test.id} value={test.id}>
                  {test.code} · {test.title}
                </option>
              ))}
            </select>
            <select
              value={runStatus}
              onChange={(event) => setRunStatus(event.target.value as TestStatus)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="approved">Aprovado</option>
              <option value="failed">Falhou</option>
              <option value="blocked">Bloqueado</option>
              <option value="retest">Reteste</option>
            </select>
            <input
              value={evidenceUrl}
              onChange={(event) => setEvidenceUrl(event.target.value)}
              placeholder="URL da evidência (opcional)"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm md:col-span-2"
            />
            <textarea
              value={evidenceNotes}
              onChange={(event) => setEvidenceNotes(event.target.value)}
              placeholder="Evidência, resultado observado, erro encontrado ou observação do key user"
              className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm md:col-span-2"
            />
          </div>
          <button
            onClick={() => registerRun.mutate()}
            disabled={registerRun.isPending || !selectedCase}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground disabled:opacity-50"
          >
            {runStatus === "retest" ? <RotateCcw className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />}
            {registerRun.isPending ? "Registrando…" : "Registrar teste"}
          </button>
        </div>
      </section>

      {canManageHomologation && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold uppercase">
            <ClipboardList className="h-5 w-5 text-primary" /> Novo caso de teste
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={caseCode} onChange={(e) => setCaseCode(e.target.value)} placeholder="Código: FIN-003" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <input value={caseSector} onChange={(e) => setCaseSector(e.target.value)} placeholder="Setor" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <input value={caseTitle} onChange={(e) => setCaseTitle(e.target.value)} placeholder="Título do teste" className="rounded-md border border-input bg-background px-3 py-2 text-sm md:col-span-2" />
            <textarea value={caseExpected} onChange={(e) => setCaseExpected(e.target.value)} placeholder="Resultado esperado" className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm md:col-span-2" />
            <select value={caseCriticality} onChange={(e) => setCaseCriticality(e.target.value as Criticality)} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="critical">Crítico</option>
              <option value="high">Alto</option>
              <option value="medium">Médio</option>
              <option value="low">Baixo</option>
            </select>
          </div>
          <button onClick={() => createCase.mutate()} disabled={createCase.isPending} className="mt-3 rounded-md border border-border px-4 py-2 text-sm font-bold uppercase">
            {createCase.isPending ? "Salvando…" : "Adicionar roteiro"}
          </button>
        </section>
      )}

      {canManageHomologation && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold uppercase">
            <CheckCheck className="h-5 w-5 text-primary" /> Aceite formal
          </h2>
          {tenant?.environment === "production" ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              O aceite aprovado é bloqueado no tenant de produção. Troque para <strong>Norte Sul — Demonstração</strong>,
              execute os testes e registre o aceite lá.
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                O banco impede o aceite aprovado enquanto existir caso crítico sem resultado final “Aprovado”.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <input value={releaseName} onChange={(e) => setReleaseName(e.target.value)} placeholder="Nome da release" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
                <input value={releaseVersion} onChange={(e) => setReleaseVersion(e.target.value)} placeholder="Versão/commit (opcional)" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
                <select value={releaseDecision} onChange={(e) => setReleaseDecision(e.target.value as "accepted" | "rejected")} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="accepted">Aceitar release</option>
                  <option value="rejected">Rejeitar release</option>
                </select>
                <textarea value={releaseStatement} onChange={(e) => setReleaseStatement(e.target.value)} placeholder="Declaração, ressalvas e responsável pelo aceite" className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm md:col-span-2" />
              </div>
              <button onClick={() => recordAcceptance.mutate()} disabled={recordAcceptance.isPending || (releaseDecision === "accepted" && summary.criticalOpen > 0)} className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground disabled:opacity-50">
                {recordAcceptance.isPending ? "Registrando…" : "Registrar decisão formal"}
              </button>
            </>
          )}

          <div className="mt-5 space-y-2">
            {(acceptances.data ?? []).map((item) => (
              <div key={item.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{item.release_name}</span>
                  {item.release_version && <span className="font-mono text-xs text-muted-foreground">{item.release_version}</span>}
                  <span className="ml-auto text-xs font-bold uppercase">{item.decision === "accepted" ? "Aceito" : "Rejeitado"}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{item.statement}</p>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(item.accepted_at).toLocaleString("pt-BR")}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {organizationAdmin && (
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
