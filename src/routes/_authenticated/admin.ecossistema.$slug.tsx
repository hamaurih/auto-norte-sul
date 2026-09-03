import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  getIntegrationBySlug,
  listIntegrationLogs,
  listIntegrationSettings,
  integrationRetryLog,
  integrationRunSync,
  integrationSaveSetting,
  integrationSetStatus,
  integrationTestConnection,
  integrationToggleActive,
} from "@/lib/integrations.functions";
import { ArrowLeft, PlugZap, PowerOff, RefreshCcw, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/ecossistema/$slug")({
  component: IntegrationDetail,
});

type Integration = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string;
  status: "disconnected" | "connected" | "error" | "configuring";
  active: boolean;
  last_sync_at: string | null;
};
type Setting = { id: string; key: string; value_encrypted: string | null; is_secret: boolean; configured: boolean };
type Log = {
  id: string;
  event_type: string;
  status: "success" | "error" | "warning" | "pending";
  message: string | null;
  created_at: string;
};

/* Per-integration configuration schemas — non-secret fields live in DB (masked if secret),
   truly sensitive values (client secrets, tokens, certificados) devem ir para Secrets/Edge Functions. */
type FieldSpec = { key: string; label: string; type?: "text" | "password" | "textarea"; is_secret?: boolean; placeholder?: string; help?: string };
type IntegrationSpec = { intro?: string; fields: FieldSpec[]; syncActions?: { scope: string; label: string }[]; warning?: string };

const specs: Record<string, IntegrationSpec> = {
  bling: {
    intro: "Conecte-se ao Bling via OAuth 2.0 para sincronizar produtos, estoque, preços e pedidos.",
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "ID do app Bling" },
      { key: "client_secret", label: "Client Secret", type: "password", is_secret: true, help: "Armazenado com segurança. Nunca é exibido novamente." },
      { key: "environment", label: "Ambiente", placeholder: "produção" },
    ],
    syncActions: [
      { scope: "produtos", label: "Sincronizar produtos" },
      { scope: "imagens", label: "Sincronizar imagens" },
      { scope: "estoque", label: "Sincronizar estoque" },
      { scope: "precos", label: "Sincronizar preços" },
      { scope: "pedidos", label: "Enviar pedidos" },
    ],
  },
  "mercado-livre": {
    fields: [
      { key: "app_id", label: "App ID" },
      { key: "client_secret", label: "Client Secret", type: "password", is_secret: true },
      { key: "seller_id", label: "Seller ID" },
    ],
    syncActions: [
      { scope: "anuncios", label: "Sincronizar anúncios" },
      { scope: "estoque", label: "Sincronizar estoque" },
      { scope: "pedidos", label: "Importar pedidos" },
    ],
  },
  shopee: {
    fields: [
      { key: "partner_id", label: "Partner ID" },
      { key: "partner_key", label: "Partner Key", type: "password", is_secret: true },
      { key: "shop_id", label: "Shop ID" },
    ],
    syncActions: [
      { scope: "produtos", label: "Sincronizar produtos" },
      { scope: "pedidos", label: "Importar pedidos" },
    ],
  },
  amazon: {
    fields: [
      { key: "marketplace_id", label: "Marketplace ID", placeholder: "A2Q3Y263D00KWC (Brasil)" },
      { key: "seller_id", label: "Seller ID" },
      { key: "refresh_token", label: "Refresh Token", type: "password", is_secret: true },
    ],
    syncActions: [
      { scope: "produtos", label: "Sincronizar catálogo" },
      { scope: "pedidos", label: "Importar pedidos" },
    ],
  },
  "tiktok-shop": {
    fields: [
      { key: "app_key", label: "App Key" },
      { key: "app_secret", label: "App Secret", type: "password", is_secret: true },
      { key: "shop_id", label: "Shop ID" },
    ],
  },
  "melhor-envio": {
    fields: [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client Secret", type: "password", is_secret: true },
      { key: "cep_origem", label: "CEP de origem" },
    ],
  },
  "mercado-pago": {
    fields: [
      { key: "access_token", label: "Access Token", type: "password", is_secret: true },
      { key: "public_key", label: "Public Key" },
      { key: "webhook_url", label: "URL de Webhook" },
    ],
  },
  stone: {
    intro:
      "Conciliação oficial Stone: recebe arquivos Pix por webhook e importa vendas, taxas, cancelamentos e dados de liquidação. A captura do checkout/PDV usa credenciais separadas.",
    fields: [
      {
        key: "api_key",
        label: "Chave de API da Conciliação Stone",
        type: "password",
        is_secret: true,
        help: "Chave Secreta criada no Portal Stone. É enviada como usuário no HTTP Basic Auth e nunca é reexibida.",
      },
      {
        key: "merchant_document",
        label: "CNPJ ou CPF do estabelecimento",
        placeholder: "Somente números",
      },
      {
        key: "webhook_url",
        label: "URL pública do webhook",
        placeholder: "https://www.nortesulauto.com.br/api/public/stone/conciliation/webhook",
        help: "A URL deve usar HTTPS. O sistema acrescenta automaticamente um token secreto antes de cadastrá-la na Stone.",
      },
    ],
    syncActions: [
      { scope: "solicitar-pix-ontem", label: "Solicitar Pix de ontem" },
      { scope: "processar-pix", label: "Importar arquivos recebidos" },
    ],
    warning:
      "Esta conexão faz conciliação financeira. Para cobrar no site ainda é preciso habilitar a API transacional Stone/Pagar.me; no PDV, o produto TEF/SDK da Stone.",
  },
  whatsapp: {
    fields: [
      { key: "phone_number_id", label: "Phone Number ID" },
      { key: "access_token", label: "Access Token", type: "password", is_secret: true },
      { key: "business_account_id", label: "Business Account ID" },
    ],
  },
  "google-merchant": {
    fields: [
      { key: "merchant_id", label: "Merchant ID" },
      { key: "service_account_json", label: "Service Account (JSON)", type: "textarea", is_secret: true },
    ],
  },
  "meta-capi": {
    fields: [
      { key: "pixel_id", label: "Pixel ID" },
      { key: "access_token", label: "Access Token da CAPI", type: "password", is_secret: true },
      { key: "test_event_code", label: "Test Event Code (opcional)" },
    ],
  },
  "ia-aes-business": {
    intro: "Endpoint da IA proprietária e escopos de dados consultáveis.",
    fields: [
      { key: "endpoint_url", label: "URL da API" },
      { key: "api_key", label: "Chave da API", type: "password", is_secret: true },
      { key: "scopes", label: "Escopos consultáveis (separados por vírgula)", placeholder: "produtos,pedidos,clientes" },
      { key: "chat_enabled", label: "Chat ativo no site (true/false)", placeholder: "true" },
    ],
  },
  fiscal: {
    warning:
      "Na fase inicial, a emissão fiscal será feita via Bling. Este módulo está preparado para evolução futura — nenhuma emissão real ocorre aqui.",
    fields: [
      { key: "cnpj", label: "CNPJ" },
      { key: "inscricao_estadual", label: "Inscrição Estadual" },
      { key: "regime_tributario", label: "Regime Tributário (Simples, Lucro Presumido, Real)" },
      { key: "ambiente", label: "Ambiente (homologação/produção)", placeholder: "homologacao" },
      { key: "natureza_operacao", label: "Natureza da operação padrão", placeholder: "Venda de mercadoria" },
      { key: "cfop_padrao", label: "CFOP padrão", placeholder: "5102" },
      { key: "ncm_padrao", label: "NCM padrão" },
      { key: "certificado_a1", label: "Certificado A1 (arquivo .pfx em base64)", type: "textarea", is_secret: true, help: "Armazenado como secret. Nunca é exibido novamente." },
      { key: "certificado_senha", label: "Senha do certificado", type: "password", is_secret: true },
    ],
  },
  nuvemshop: {
    intro: "Conexão OAuth para catálogo, estoque e pedidos da loja Nuvemshop.",
    fields: [
      { key: "store_id", label: "ID da loja" },
      { key: "access_token", label: "Access Token", type: "password", is_secret: true },
    ],
    syncActions: [
      { scope: "produtos", label: "Sincronizar produtos" },
      { scope: "estoque", label: "Sincronizar estoque" },
      { scope: "pedidos", label: "Importar pedidos" },
    ],
  },
  shopify: {
    intro: "Conexão com a Admin API da loja Shopify para catálogo, estoque e pedidos.",
    fields: [
      { key: "shop_domain", label: "Domínio da loja", placeholder: "minha-loja.myshopify.com" },
      { key: "admin_access_token", label: "Admin API Access Token", type: "password", is_secret: true },
      { key: "api_version", label: "Versão da API", placeholder: "2026-01" },
    ],
    syncActions: [
      { scope: "produtos", label: "Sincronizar produtos" },
      { scope: "estoque", label: "Sincronizar estoque" },
      { scope: "pedidos", label: "Importar pedidos" },
    ],
  },
  woocommerce: {
    fields: [
      { key: "store_url", label: "URL da loja" },
      { key: "consumer_key", label: "Consumer Key", type: "password", is_secret: true },
      { key: "consumer_secret", label: "Consumer Secret", type: "password", is_secret: true },
    ],
    syncActions: [
      { scope: "produtos", label: "Sincronizar produtos" },
      { scope: "pedidos", label: "Importar pedidos" },
    ],
  },
  tray: {
    fields: [
      { key: "store_id", label: "ID da loja" },
      { key: "api_key", label: "API Key", type: "password", is_secret: true },
      { key: "api_secret", label: "API Secret", type: "password", is_secret: true },
    ],
    syncActions: [
      { scope: "produtos", label: "Sincronizar produtos" },
      { scope: "pedidos", label: "Importar pedidos" },
    ],
  },
  "magalu-marketplace": {
    fields: [
      { key: "seller_id", label: "Seller ID" },
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client Secret", type: "password", is_secret: true },
    ],
    syncActions: [
      { scope: "anuncios", label: "Sincronizar anúncios" },
      { scope: "pedidos", label: "Importar pedidos" },
    ],
  },
  olist: {
    fields: [
      { key: "seller_id", label: "Seller ID" },
      { key: "api_key", label: "API Key", type: "password", is_secret: true },
    ],
    syncActions: [
      { scope: "produtos", label: "Sincronizar produtos" },
      { scope: "pedidos", label: "Importar pedidos" },
    ],
  },
  frenet: {
    fields: [
      { key: "token", label: "Token", type: "password", is_secret: true },
      { key: "cep_origem", label: "CEP de origem" },
    ],
    syncActions: [{ scope: "cotacoes", label: "Testar cotação de frete" }],
  },
  kangu: {
    fields: [
      { key: "token", label: "Token", type: "password", is_secret: true },
      { key: "cep_origem", label: "CEP de origem" },
    ],
    syncActions: [{ scope: "cotacoes", label: "Testar cotação de frete" }],
  },
  pagbank: {
    intro: "Use OAuth/Connect do PagBank para autorização por ambiente.",
    fields: [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client Secret", type: "password", is_secret: true },
      { key: "environment", label: "Ambiente", placeholder: "sandbox" },
      { key: "webhook_url", label: "URL de Webhook" },
    ],
  },
  pagarme: {
    fields: [
      { key: "secret_key", label: "Secret Key", type: "password", is_secret: true },
      { key: "public_key", label: "Public Key" },
      { key: "webhook_url", label: "URL de Webhook" },
    ],
  },
  asaas: {
    fields: [
      { key: "api_key", label: "API Key", type: "password", is_secret: true },
      { key: "environment", label: "Ambiente", placeholder: "sandbox" },
      { key: "webhook_url", label: "URL de Webhook" },
    ],
  },
  "mobile-app": {
    fields: [
      { key: "api_base_url", label: "URL base da API mobile" },
      { key: "push_key", label: "Chave de push notifications", type: "password", is_secret: true },
    ],
  },
};

const statusMeta = {
  connected: { label: "Conectado", className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  disconnected: { label: "Desconectado", className: "bg-muted text-muted-foreground border-border" },
  error: { label: "Erro", className: "bg-destructive/10 text-destructive border-destructive/30" },
  configuring: { label: "Em configuração", className: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
} as const;

const logStatusMeta = {
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  error: "bg-destructive/10 text-destructive border-destructive/30",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  pending: "bg-blue-500/10 text-blue-700 border-blue-500/30",
} as const;

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

function IntegrationDetail() {
  const { slug } = Route.useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState("config");

  const getIntegrationFn = useServerFn(getIntegrationBySlug);
  const listSettingsFn = useServerFn(listIntegrationSettings);
  const listLogsFn = useServerFn(listIntegrationLogs);

  const { data: integration, isLoading } = useQuery({
    queryKey: ["integration", slug],
    queryFn: async () => {
      const data = await getIntegrationFn({ data: { slug } });
      if (!data) throw notFound();
      return data as Integration;
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["integration-settings", integration?.id],
    enabled: !!integration?.id,
    queryFn: () => listSettingsFn({ data: { integration_id: integration!.id } }),
  });

  const { data: logs } = useQuery({
    queryKey: ["integration-logs", integration?.id],
    enabled: !!integration?.id,
    queryFn: () => listLogsFn({ data: { integration_id: integration!.id } }),
  });

  const saveFn = useServerFn(integrationSaveSetting);
  const testFn = useServerFn(integrationTestConnection);
  const toggleFn = useServerFn(integrationToggleActive);
  const statusFn = useServerFn(integrationSetStatus);
  const syncFn = useServerFn(integrationRunSync);
  const retryFn = useServerFn(integrationRetryLog);

  const save = useMutation({
    mutationFn: (v: { key: string; value: string; is_secret?: boolean }) =>
      saveFn({ data: { integration_id: integration!.id, ...v } }),
    onSuccess: () => {
      toast.success("Configuração salva");
      qc.invalidateQueries({ queryKey: ["integration-settings", integration!.id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const test = useMutation({
    mutationFn: () => testFn({ data: { id: integration!.id, slug } }),
    onSuccess: (r) => {
      toast.success("Teste registrado", { description: (r as any)?.message });
      qc.invalidateQueries({ queryKey: ["integration-logs", integration!.id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const toggle = useMutation({
    mutationFn: () => toggleFn({ data: { id: integration!.id, active: !integration!.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integration", slug] }),
  });

  const changeStatus = useMutation({
    mutationFn: (s: Integration["status"]) => statusFn({ data: { id: integration!.id, status: s } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integration", slug] }),
  });

  const runSync = useMutation({
    mutationFn: (scope: string) => syncFn({ data: { id: integration!.id, slug, scope } }),
    onSuccess: () => {
      toast.success("Sincronização enfileirada");
      qc.invalidateQueries({ queryKey: ["integration-logs", integration!.id] });
      qc.invalidateQueries({ queryKey: ["integration", slug] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const retry = useMutation({
    mutationFn: (log_id: string) => retryFn({ data: { log_id } }),
    onSuccess: () => {
      toast.success("Reprocessamento solicitado");
      qc.invalidateQueries({ queryKey: ["integration-logs", integration!.id] });
    },
  });

  if (isLoading || !integration) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const spec = specs[slug] ?? { fields: [] };
  const s = statusMeta[integration.status];
  const settingFor = (key: string) => settings?.find((x) => x.key === key);
  const valueFor = (key: string) => settingFor(key)?.value_encrypted ?? "";
  const isSecretFilled = (key: string, is_secret?: boolean) => !!is_secret && Boolean(settingFor(key)?.configured);

  return (
    <div className="space-y-4">
      <Button asChild size="sm" variant="ghost">
        <Link to="/admin/ecossistema"><ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar</Link>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold uppercase">{integration.name}</h2>
          <p className="text-sm text-muted-foreground">{integration.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={s.className}>{s.label}</Badge>
          <Button size="sm" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
            <PlugZap className="mr-1 h-4 w-4" /> Testar conexão
          </Button>
          <Button size="sm" variant="outline" onClick={() => toggle.mutate()}>
            <PowerOff className="mr-1 h-4 w-4" /> {integration.active ? "Desativar" : "Ativar"}
          </Button>
          {integration.status === "connected" ? (
            <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate("disconnected")}>Desconectar</Button>
          ) : (
            <Button size="sm" onClick={() => changeStatus.mutate("configuring")}>Conectar</Button>
          )}
        </div>
      </div>

      {spec.warning && (
        <Alert>
          <AlertDescription>{spec.warning}</AlertDescription>
        </Alert>
      )}
      {spec.intro && <p className="text-sm text-muted-foreground">{spec.intro}</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="config">Configurações</TabsTrigger>
          <TabsTrigger value="sync">Sincronização</TabsTrigger>
          <TabsTrigger value="logs">Logs recentes</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-4">
          <Card>
            <CardHeader>
              <p className="text-sm font-semibold">Credenciais e parâmetros</p>
              <p className="text-xs text-muted-foreground">
                Segredos são armazenados de forma protegida e nunca reexibidos após salvar. Para credenciais críticas
                (tokens, certificados), a comunicação com o provedor é feita por funções seguras do servidor.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {spec.fields.length === 0 && <p className="text-sm text-muted-foreground">Sem parâmetros configuráveis.</p>}
              {spec.fields.map((f) => (
                <SettingRow
                  key={f.key}
                  field={f}
                  currentValue={valueFor(f.key)}
                  hasSecret={isSecretFilled(f.key, f.is_secret)}
                  onSave={(value) => save.mutate({ key: f.key, value, is_secret: f.is_secret })}
                />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <Card>
            <CardHeader>
              <p className="text-sm font-semibold">Ações de sincronização</p>
              <p className="text-xs text-muted-foreground">Última: {formatDate(integration.last_sync_at)}</p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(spec.syncActions ?? [{ scope: "manual", label: "Sincronização manual" }]).map((a) => (
                <Button key={a.scope} size="sm" variant="secondary" onClick={() => runSync.mutate(a.scope)} disabled={runSync.isPending}>
                  <RefreshCcw className="mr-1 h-4 w-4" /> {a.label}
                </Button>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {(!logs || logs.length === 0) ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>
              ) : (
                <ul className="divide-y">
                  {logs.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={logStatusMeta[l.status]}>{l.status}</Badge>
                          <span className="font-mono text-xs">{l.event_type}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(l.created_at)}</span>
                        </div>
                        {l.message && <p className="mt-1 text-sm">{l.message}</p>}
                      </div>
                      {l.status === "error" && (
                        <Button size="sm" variant="outline" onClick={() => retry.mutate(l.id)}>
                          Reprocessar
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SettingRow({
  field,
  currentValue,
  hasSecret,
  onSave,
}: {
  field: FieldSpec;
  currentValue: string;
  hasSecret: boolean;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(field.is_secret ? "" : currentValue);
  const isTextarea = field.type === "textarea";
  const inputType = field.type === "password" || field.is_secret ? "password" : "text";
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
      <div>
        <Label className="text-xs">{field.label}</Label>
        {isTextarea ? (
          <textarea
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={4}
            value={v}
            placeholder={hasSecret ? "•••••••• (valor salvo)" : field.placeholder}
            onChange={(e) => setV(e.target.value)}
          />
        ) : (
          <Input
            className="mt-1"
            type={inputType}
            value={v}
            placeholder={hasSecret ? "•••••••• (valor salvo)" : field.placeholder}
            onChange={(e) => setV(e.target.value)}
          />
        )}
        {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
      </div>
      <div className="flex items-end">
        <Button size="sm" onClick={() => v && onSave(v)} disabled={!v}>
          <Save className="mr-1 h-4 w-4" /> Salvar
        </Button>
      </div>
    </div>
  );
}
