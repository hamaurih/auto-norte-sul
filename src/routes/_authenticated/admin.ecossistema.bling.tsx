import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ArrowLeft,
  PlugZap,
  RefreshCcw,
  ShieldAlert,
  Link2,
  Link2Off,
  Package,
  ImageIcon,
  Boxes,
  DollarSign,
  ShoppingBag,
  Users,
  FileText,
  Settings,
  ChevronRight,
} from "lucide-react";
import {
  getBlingStats,
  getBlingStatus,
  reprocessBlingLog,
  revokeBlingConnection,
  sendPendingOrders,
  syncBlingCustomers,
  syncBlingImages,
  syncBlingPrices,
  syncBlingProducts,
  syncBlingStock,
  testBlingConnection,
  updateBlingConfig,
} from "@/lib/bling.functions";
import { getSecureBlingAuthUrl } from "@/lib/bling-oauth.functions";

export const Route = createFileRoute("/_authenticated/admin/ecossistema/bling")({
  head: () => ({ meta: [{ title: "Bling · Ecossistema · Admin" }] }),
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/admin" });
  },
  component: BlingModule,
});

type BlingLog = {
  id: string;
  entity: string;
  entity_id: string | null;
  action: string;
  status: "sucesso" | "erro" | "pendente";
  message: string | null;
  payload: any;
  response: any;
  created_at: string;
};

const statusBadge = {
  connected: { label: "Conectado", cn: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  disconnected: { label: "Desconectado", cn: "bg-muted text-muted-foreground border-border" },
  error: { label: "Erro", cn: "bg-destructive/10 text-destructive border-destructive/30" },
  configuring: { label: "Autorização pendente", cn: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
} as const;

const logBadge = {
  sucesso: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  erro: "bg-destructive/10 text-destructive border-destructive/30",
  pendente: "bg-blue-500/10 text-blue-700 border-blue-500/30",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR") : "—");

function BlingModule() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("conexao");
  const [logDetail, setLogDetail] = useState<BlingLog | null>(null);

  const statusFn = useServerFn(getBlingStatus);
  const statsFn = useServerFn(getBlingStats);
  const authUrlFn = useServerFn(getSecureBlingAuthUrl);
  const testFn = useServerFn(testBlingConnection);
  const revokeFn = useServerFn(revokeBlingConnection);
  const updateFn = useServerFn(updateBlingConfig);
  const reprocessFn = useServerFn(reprocessBlingLog);

  const syncProducts = useServerFn(syncBlingProducts);
  const syncImages = useServerFn(syncBlingImages);
  const syncStock = useServerFn(syncBlingStock);
  const syncPrices = useServerFn(syncBlingPrices);
  const syncCustomers = useServerFn(syncBlingCustomers);
  const sendOrders = useServerFn(sendPendingOrders);

  const status = useQuery({ queryKey: ["bling-status"], queryFn: () => statusFn() });
  const stats = useQuery({ queryKey: ["bling-stats"], queryFn: () => statsFn() });

  const logs = useQuery({
    queryKey: ["bling-logs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bling_sync_logs")
        .select("id,entity,entity_id,action,status,message,payload,response,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as BlingLog[];
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["bling-status"] });
    qc.invalidateQueries({ queryKey: ["bling-stats"] });
    qc.invalidateQueries({ queryKey: ["bling-logs"] });
  };

  const connectMut = useMutation({
    mutationFn: async () => {
      // Domínio publicado fixo — é a Redirect URI cadastrada no app do Bling.
      const redirectUri = "https://www.nortesulauto.com.br/api/public/bling/callback";
      return authUrlFn({ data: { redirectUri } });
    },
    onSuccess: (r) => {
      // Abre em nova aba: o Bling recusa ser carregado dentro do iframe do preview
      // (X-Frame-Options), então navegar via window.location.href mostra "conexão recusada".
      const w = window.open((r as any).url, "_blank", "noopener,noreferrer");
      if (!w) {
        toast.error("Popup bloqueado. Libere pop-ups para este site e tente novamente.");
      } else {
        toast.success("Autorize o acesso na nova aba. Depois volte aqui e clique em Testar conexão.");
      }
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const testMut = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r: any) => {
      if (r.status === "sucesso") toast.success(r.message);
      else toast.error(r.message);
      invalidateAll();
    },
  });

  const revokeMut = useMutation({
    mutationFn: () => revokeFn(),
    onSuccess: () => {
      toast.success("Conexão revogada");
      invalidateAll();
    },
  });

  const configMut = useMutation({
    mutationFn: (patch: any) => updateFn({ data: patch }),
    onSuccess: () => {
      toast.success("Configuração atualizada");
      qc.invalidateQueries({ queryKey: ["bling-status"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const [busy, setBusy] = useState<string | null>(null);
  const runSync = (fn: () => Promise<any>, label: string) => async () => {
    if (busy) return;
    setBusy(label);
    toast.info(`${label}: sincronização iniciada. Isso pode levar alguns minutos…`);
    try {
      const r: any = await fn();
      if (r?.ok) toast.success(`${label}: ${r.message}`);
      else toast.error(r?.message ?? `${label} falhou`);
    } catch (e: any) {
      toast.error(`${label}: ${e?.message ?? "Erro"}`);
    } finally {
      setBusy(null);
      invalidateAll();
    }
  };


  const reprocessMut = useMutation({
    mutationFn: (log_id: string) => reprocessFn({ data: { log_id } }),
    onSuccess: () => {
      toast.success("Reprocessamento enfileirado");
      invalidateAll();
    },
  });

  if (status.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const s = status.data!;
  const cfg = s.config ?? ({} as any);
  const conn = statusBadge[s.connectionStatus];
  const errorLogs = (logs.data ?? []).filter((l) => l.status === "erro").length;

  return (
    <div className="space-y-4">
      <Button asChild size="sm" variant="ghost">
        <Link to="/admin/ecossistema">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar ao Ecossistema
        </Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold uppercase">Bling ERP</h2>
          <p className="text-sm text-muted-foreground">
            ERP operacional do negócio. O site permanece como camada comercial (B2B/B2C, vendedores, promoções, cupons, IA).
          </p>
        </div>
        <Badge variant="outline" className={conn.cn}>
          {conn.label}
        </Badge>
      </div>

      {(!s.clientIdConfigured || !s.clientSecretConfigured) && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            Para conectar ao Bling, adicione os secrets <code>BLING_CLIENT_ID</code> e <code>BLING_CLIENT_SECRET</code> nas
            configurações de backend. Peça esses valores no app <a className="underline" href="https://developer.bling.com.br" target="_blank" rel="noreferrer">developer.bling.com.br</a>.
            <br />
            Redirect URI a cadastrar no Bling:{" "}
            <code>https://www.nortesulauto.com.br/api/public/bling/callback</code>
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="conexao"><Link2 className="mr-1 h-3.5 w-3.5" />Conexão</TabsTrigger>
          <TabsTrigger value="produtos"><Package className="mr-1 h-3.5 w-3.5" />Produtos</TabsTrigger>
          <TabsTrigger value="imagens"><ImageIcon className="mr-1 h-3.5 w-3.5" />Imagens</TabsTrigger>
          <TabsTrigger value="estoque"><Boxes className="mr-1 h-3.5 w-3.5" />Estoque</TabsTrigger>
          <TabsTrigger value="precos"><DollarSign className="mr-1 h-3.5 w-3.5" />Preços</TabsTrigger>
          <TabsTrigger value="pedidos"><ShoppingBag className="mr-1 h-3.5 w-3.5" />Pedidos</TabsTrigger>
          <TabsTrigger value="clientes"><Users className="mr-1 h-3.5 w-3.5" />Clientes</TabsTrigger>
          <TabsTrigger value="logs"><FileText className="mr-1 h-3.5 w-3.5" />Logs</TabsTrigger>
          <TabsTrigger value="configuracoes"><Settings className="mr-1 h-3.5 w-3.5" />Configurações</TabsTrigger>
        </TabsList>

        {/* ============ CONEXÃO ============ */}
        <TabsContent value="conexao" className="mt-4">
          <Card>
            <CardHeader>
              <p className="text-sm font-semibold">OAuth 2.0 · Bling API v3</p>
              <p className="text-xs text-muted-foreground">
                Client Secret, access token e refresh token nunca são exibidos no front-end — ficam armazenados no backend.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Info label="Última autorização" value={fmt(cfg?.last_authorized_at)} />
                <Info label="Token expira em" value={fmt(cfg?.expires_at)} />
                <Info label="Último teste" value={`${fmt(cfg?.last_test_at)} ${cfg?.last_test_status ? `· ${cfg.last_test_status}` : ""}`} />
                <Info label="Escopos" value={cfg?.scope ?? "—"} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => connectMut.mutate()}
                  disabled={connectMut.isPending || !s.clientIdConfigured || !s.clientSecretConfigured}
                >
                  <Link2 className="mr-1 h-4 w-4" />
                  {s.connectionStatus === "connected" ? "Reautorizar" : "Conectar ao Bling"}
                </Button>
                <Button variant="secondary" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
                  <PlugZap className="mr-1 h-4 w-4" /> Testar conexão
                </Button>
                <Button variant="outline" onClick={() => revokeMut.mutate()} disabled={revokeMut.isPending || s.connectionStatus === "disconnected"}>
                  <Link2Off className="mr-1 h-4 w-4" /> Revogar conexão
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ PRODUTOS ============ */}
        <TabsContent value="produtos" className="mt-4">
          <SyncCard
            title="Produtos"
            description="Importa o catálogo do Bling e mantém sincronizado."
            lastSync={cfg?.updated_at}
            stats={[
              { label: "Total de logs", value: stats.data?.total ?? 0 },
              { label: "Com erro", value: stats.data?.errors ?? 0 },
              { label: "Pendentes", value: stats.data?.pending ?? 0 },
            ]}
            actionLabel="Sincronizar produtos"
            onSync={runSync(syncProducts, "Produtos")}
            pending={busy === "Produtos"}
          >
            <ErrorList
              logs={(logs.data ?? []).filter((l) => l.entity === "produto" && l.status === "erro")}
              onReprocess={(id) => reprocessMut.mutate(id)}
            />
          </SyncCard>
        </TabsContent>

        {/* ============ IMAGENS ============ */}
        <TabsContent value="imagens" className="mt-4">
          <SyncCard
            title="Imagens"
            description="Baixa as imagens do Bling e copia cada arquivo para o Storage Norte Sul. Links temporários nunca são mantidos como imagem definitiva."
            lastSync={null}
            actionLabel="Sincronizar 1 lote"
            onSync={runSync(() => syncImages({ data: { batchSize: 25, onlyMissing: true } }), "Imagens")}
            pending={busy === "Imagens" || busy === "Imagens (auto)"}
          >
            <ImageAutoSyncPanel
              disabled={!!busy}
              onStart={async (setProgress) => {
                if (busy) return;
                setBusy("Imagens (auto)");
                try {
                  let iter = 0;
                  while (iter < 100) {
                    iter++;
                    const r: any = await syncImages({ data: { batchSize: 25, onlyMissing: true } });
                    setProgress({
                      iter,
                      processed: r.processed,
                      withImages: r.withImages,
                      imagesSaved: r.imagesSaved,
                      remaining: r.remaining,
                    });
                    if (!r.processed || r.remaining === 0) break;
                    // pequena pausa entre lotes
                    await new Promise((res) => setTimeout(res, 800));
                  }
                  toast.success("Sincronização de imagens concluída (ou pausada em 100 lotes)");
                } catch (e: any) {
                  toast.error(`Auto-sync falhou: ${e?.message ?? "Erro"}`);
                } finally {
                  setBusy(null);
                  invalidateAll();
                }
              }}
            />
            <div className="flex items-center justify-between rounded border border-border p-3">
              <div>
                <p className="text-sm font-medium">Imagem do Bling sobrescreve imagem manual</p>
                <p className="text-xs text-muted-foreground">Se desligado, imagens carregadas manualmente prevalecem.</p>
              </div>
              <Switch
                checked={!!cfg?.image_overwrites_manual}
                onCheckedChange={(v) => configMut.mutate({ image_overwrites_manual: v })}
              />
            </div>
            <ErrorList
              logs={(logs.data ?? []).filter((l) => l.entity === "imagem" && l.status === "erro")}
              onReprocess={(id) => reprocessMut.mutate(id)}
            />
          </SyncCard>
        </TabsContent>



        {/* ============ ESTOQUE ============ */}
        <TabsContent value="estoque" className="mt-4">
          <SyncCard
            title="Estoque"
            description="Atualiza saldos e status de disponibilidade."
            lastSync={null}
            actionLabel="Sincronizar estoque"
            onSync={runSync(syncStock, "Estoque")}
            pending={busy === "Estoque"}
          >
            <div className="flex items-center justify-between rounded border border-border p-3">
              <div>
                <p className="text-sm font-medium">Produto sem estoque fica oculto</p>
                <p className="text-xs text-muted-foreground">Se desligado, aparece marcado como “Indisponível”.</p>
              </div>
              <Switch
                checked={!!cfg?.hide_out_of_stock}
                onCheckedChange={(v) => configMut.mutate({ hide_out_of_stock: v })}
              />
            </div>
            <ErrorList
              logs={(logs.data ?? []).filter((l) => l.entity === "estoque" && l.status === "erro")}
              onReprocess={(id) => reprocessMut.mutate(id)}
            />
          </SyncCard>
        </TabsContent>

        {/* ============ PREÇOS ============ */}
        <TabsContent value="precos" className="mt-4">
          <SyncCard
            title="Preços"
            description="Bling controla preços B2C. Preço B2B e promoções continuam no site."
            lastSync={null}
            actionLabel="Sincronizar preços"
            onSync={runSync(syncPrices, "Preços")}
            pending={busy === "Preços"}
          >
            <Toggle
              label="Bling controla preço B2C"
              help="Preços vindos do Bling atualizam a vitrine B2C."
              checked={!!cfg?.source_price_b2c}
              onChange={(v) => configMut.mutate({ source_price_b2c: v })}
            />
            <Toggle
              label="Preço manual do site pode sobrescrever preço do Bling"
              help="Quando ligado, alterações manuais no admin prevalecem até a próxima edição no Bling."
              checked={!!cfg?.manual_price_overrides}
              onChange={(v) => configMut.mutate({ manual_price_overrides: v })}
            />
            <Alert>
              <AlertDescription className="text-xs">
                Preço B2B, tabelas por vendedor, cupons e promoções permanecem controlados exclusivamente pelo site.
              </AlertDescription>
            </Alert>
            <ErrorList
              logs={(logs.data ?? []).filter((l) => l.entity === "preco" && l.status === "erro")}
              onReprocess={(id) => reprocessMut.mutate(id)}
            />
          </SyncCard>
        </TabsContent>

        {/* ============ PEDIDOS ============ */}
        <TabsContent value="pedidos" className="mt-4">
          <SyncCard
            title="Pedidos"
            description="Envia pedidos aprovados no site para o Bling."
            lastSync={null}
            actionLabel="Enviar pedidos pendentes"
            onSync={runSync(sendOrders, "Pedidos")}
            pending={busy === "Pedidos"}
          >
            <ErrorList
              logs={(logs.data ?? []).filter((l) => l.entity === "pedido" && l.status === "erro")}
              onReprocess={(id) => reprocessMut.mutate(id)}
            />
          </SyncCard>
        </TabsContent>

        {/* ============ CLIENTES ============ */}
        <TabsContent value="clientes" className="mt-4">
          <SyncCard
            title="Clientes"
            description="Novos cadastros do site são enviados ao Bling; atualizações são propagadas."
            lastSync={null}
            actionLabel="Sincronizar clientes"
            onSync={runSync(syncCustomers, "Clientes")}
            pending={busy === "Clientes"}
          >
            <ErrorList
              logs={(logs.data ?? []).filter((l) => l.entity === "cliente" && l.status === "erro")}
              onReprocess={(id) => reprocessMut.mutate(id)}
            />
          </SyncCard>
        </TabsContent>

        {/* ============ LOGS ============ */}
        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <p className="text-sm font-semibold">Logs recentes</p>
              <p className="text-xs text-muted-foreground">
                {stats.data?.total ?? 0} eventos · {errorLogs} com erro
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-2">Data</th>
                      <th className="p-2">Tipo</th>
                      <th className="p-2">Ação</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Mensagem</th>
                      <th className="p-2">ID interno</th>
                      <th className="p-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(logs.data ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-muted-foreground">
                          Nenhum evento ainda.
                        </td>
                      </tr>
                    ) : (
                      logs.data!.map((l) => (
                        <tr key={l.id} className="border-t border-border">
                          <td className="p-2 whitespace-nowrap text-xs">{fmt(l.created_at)}</td>
                          <td className="p-2 text-xs">{l.entity}</td>
                          <td className="p-2 font-mono text-xs">{l.action}</td>
                          <td className="p-2">
                            <Badge variant="outline" className={logBadge[l.status]}>
                              {l.status}
                            </Badge>
                          </td>
                          <td className="p-2 text-xs max-w-[280px] truncate" title={l.message ?? ""}>
                            {l.message ?? "—"}
                          </td>
                          <td className="p-2 font-mono text-[10px] text-muted-foreground">{l.entity_id ?? "—"}</td>
                          <td className="p-2 text-right">
                            <Button size="sm" variant="ghost" onClick={() => setLogDetail(l)}>
                              Detalhes <ChevronRight className="ml-1 h-3 w-3" />
                            </Button>
                            {l.status === "erro" && (
                              <Button size="sm" variant="outline" className="ml-1" onClick={() => reprocessMut.mutate(l.id)}>
                                <RefreshCcw className="mr-1 h-3 w-3" /> Reprocessar
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {logDetail && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
              onClick={() => setLogDetail(null)}
            >
              <div
                className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card p-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-semibold">Detalhes do log</p>
                  <Button size="sm" variant="ghost" onClick={() => setLogDetail(null)}>Fechar</Button>
                </div>
                <div className="space-y-2 text-xs">
                  <p><b>Data:</b> {fmt(logDetail.created_at)}</p>
                  <p><b>Tipo:</b> {logDetail.entity} · <b>Ação:</b> {logDetail.action}</p>
                  <p><b>Status:</b> {logDetail.status}</p>
                  <p><b>ID interno:</b> {logDetail.entity_id ?? "—"}</p>
                  <p><b>Mensagem:</b> {logDetail.message ?? "—"}</p>
                  <div>
                    <b>Payload:</b>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2">{JSON.stringify(logDetail.payload, null, 2)}</pre>
                  </div>
                  <div>
                    <b>Resposta:</b>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2">{JSON.stringify(logDetail.response, null, 2)}</pre>
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ============ CONFIGURAÇÕES ============ */}
        <TabsContent value="configuracoes" className="mt-4">
          <Card>
            <CardHeader>
              <p className="text-sm font-semibold">Regras estratégicas</p>
              <p className="text-xs text-muted-foreground">
                Define quais dados o Bling controla. B2B, promoções e cupons são sempre do site.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <Toggle label="Integração ativa" checked={!!cfg?.active} onChange={(v) => configMut.mutate({ active: v })} />
              <Toggle label="Bling é fonte principal de produtos" checked={!!cfg?.source_products} onChange={(v) => configMut.mutate({ source_products: v })} />
              <Toggle label="Bling é fonte principal de estoque" checked={!!cfg?.source_stock} onChange={(v) => configMut.mutate({ source_stock: v })} />
              <Toggle label="Bling é fonte principal de preço B2C" checked={!!cfg?.source_price_b2c} onChange={(v) => configMut.mutate({ source_price_b2c: v })} />
              <Toggle label="Sincronização automática" help="Se desligado, apenas sincronização manual." checked={!!cfg?.auto_sync} onChange={(v) => configMut.mutate({ auto_sync: v })} />
              <div className="flex items-center gap-3">
                <Label className="min-w-[220px] text-sm">Intervalo (minutos)</Label>
                <Input
                  type="number"
                  min={5}
                  defaultValue={cfg?.sync_interval_minutes ?? 60}
                  className="max-w-[120px]"
                  onBlur={(e) => configMut.mutate({ sync_interval_minutes: Number(e.currentTarget.value) })}
                />
              </div>
              <Alert>
                <AlertDescription className="text-xs">
                  Preços B2B, tabelas por vendedor, cupons, promoções, IA A&amp;S Business e o app mobile permanecem
                  controlados pelo site.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded border border-border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {help && <p className="text-xs text-muted-foreground">{help}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SyncCard({
  title,
  description,
  lastSync,
  stats,
  actionLabel,
  onSync,
  pending,
  children,
}: {
  title: string;
  description: string;
  lastSync: string | null;
  stats?: { label: string; value: number }[];
  actionLabel: string;
  onSync: () => void;
  pending?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
          <p className="mt-1 text-xs text-muted-foreground">Última atualização: {fmt(lastSync)}</p>
        </div>
        <Button size="sm" onClick={onSync} disabled={pending}>
          <RefreshCcw className={`mr-1 h-4 w-4 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Sincronizando…" : actionLabel}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats && (
          <div className="grid grid-cols-3 gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded border border-border p-2 text-center">
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-[10px] uppercase text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}


function ErrorList({ logs, onReprocess }: { logs: BlingLog[]; onReprocess: (id: string) => void }) {
  if (logs.length === 0) return <p className="text-xs text-muted-foreground">Nenhum erro registrado.</p>;
  return (
    <ul className="divide-y rounded border border-border">
      {logs.slice(0, 5).map((l) => (
        <li key={l.id} className="flex items-start justify-between gap-2 p-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-mono">{l.action} · {l.entity_id ?? "—"}</p>
            <p className="text-muted-foreground truncate">{l.message ?? "—"}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => onReprocess(l.id)}>
            <RefreshCcw className="mr-1 h-3 w-3" /> Reprocessar
          </Button>
        </li>
      ))}
    </ul>
  );
}

type ImageProgress = {
  iter: number;
  processed: number;
  withImages: number;
  imagesSaved: number;
  remaining: number;
};

function ImageAutoSyncPanel({
  disabled,
  onStart,
}: {
  disabled: boolean;
  onStart: (setProgress: (p: ImageProgress) => void) => Promise<void>;
}) {
  const [progress, setProgress] = useState<ImageProgress | null>(null);
  const [running, setRunning] = useState(false);
  return (
    <div className="rounded border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Sincronizar TODAS as imagens (auto-loop)</p>
          <p className="text-xs text-muted-foreground">
            Roda vários lotes em sequência até processar todos os produtos sem imagem. Pode levar vários minutos —
            deixe esta aba aberta.
          </p>
        </div>
        <Button
          size="sm"
          disabled={disabled || running}
          onClick={async () => {
            setRunning(true);
            setProgress(null);
            await onStart((p) => setProgress(p));
            setRunning(false);
          }}
        >
          <RefreshCcw className={`mr-1 h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Rodando…" : "Buscar todas as imagens"}
        </Button>
      </div>
      {progress && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <Stat label="Lote #" value={progress.iter} />
          <Stat label="Verificados" value={progress.processed} />
          <Stat label="Com imagem" value={progress.withImages} />
          <Stat label="Imagens salvas" value={progress.imagesSaved} />
          <Stat label="Faltam" value={progress.remaining} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-background p-2 text-center">
      <p className="text-base font-bold">{value}</p>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
    </div>
  );
}
