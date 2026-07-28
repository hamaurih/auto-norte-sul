import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, CheckCircle2, XCircle, Loader2, PlugZap } from "lucide-react";

const MCP_URL = "https://norte-sul-auto-hub.lovable.app/mcp";
const MCP_URL_DEV = "https://id-preview--85fdfc37-b145-4339-b4a4-c0cd11eacb03.lovable.app/mcp";

const TOOLS = [
  { name: "search_products", desc: "Busca produtos ativos por nome, SKU ou descrição." },
  { name: "get_product", desc: "Detalhes completos de um produto pelo slug." },
  { name: "check_stock", desc: "Verifica estoque e preço atual por SKU ou slug." },
  { name: "find_by_vehicle", desc: "Encontra produtos compatíveis com um veículo (marca/modelo/ano)." },
  { name: "list_categories", desc: "Lista categorias ativas do catálogo." },
  { name: "list_brands", desc: "Lista marcas cadastradas." },
];

export const Route = createFileRoute("/_authenticated/admin/ia-aes-business")({
  head: () => ({ meta: [{ title: "IA A&S Business · Admin" }] }),
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/admin" });
  },
  component: IaAesBusiness,
});

function CopyBtn({ value }: { value: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        navigator.clipboard.writeText(value);
        toast.success("Copiado");
      }}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}

function IaAesBusiness() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [active, setActive] = useState(true);
  const [lastStatus, setLastStatus] = useState<string | null>(null);
  const [lastTested, setLastTested] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("ai_aes_config")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (data) {
        setConfigId(data.id);
        setApiUrl(data.api_url ?? "");
        setActive(data.active);
        setLastStatus(data.last_test_status);
        setLastTested(data.last_tested_at);
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    if (!configId) return;
    setSaving(true);
    const { error } = await supabase
      .from("ai_aes_config")
      .update({ api_url: apiUrl || null, active })
      .eq("id", configId);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Configuração salva");
  }

  async function testMcp() {
    setTesting(true);
    let status = "failed";
    try {
      const res = await fetch("/.mcp/list-tools", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        const count = Array.isArray(json?.tools) ? json.tools.length : 0;
        status = `ok:${count}_tools`;
        toast.success(`Conexão OK · ${count} ferramentas expostas`);
      } else {
        status = `http_${res.status}`;
        toast.error(`Falha HTTP ${res.status}`);
      }
    } catch (e) {
      status = `error:${(e as Error).message}`;
      toast.error("Erro ao conectar");
    }
    const now = new Date().toISOString();
    setLastStatus(status);
    setLastTested(now);
    if (configId) {
      await supabase
        .from("ai_aes_config")
        .update({ last_test_status: status, last_tested_at: now })
        .eq("id", configId);
    }
    setTesting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusOk = lastStatus?.startsWith("ok");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold uppercase">IA A&S Business</h1>
          <p className="text-sm text-muted-foreground">
            Conecte um agente de IA externo (Mara, ChatGPT, etc.) ao catálogo via MCP.
          </p>
        </div>
        <Badge variant={active ? "default" : "secondary"}>{active ? "Ativo" : "Inativo"}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="h-5 w-5 text-primary" />
            Endpoint MCP do site
          </CardTitle>
          <CardDescription>
            Copie e cole na plataforma da IA. Sem autenticação · somente leitura · JSON-RPC 2.0 sobre HTTP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Produção</Label>
            <div className="mt-1 flex gap-2">
              <Input readOnly value={MCP_URL} className="font-mono text-sm" />
              <CopyBtn value={MCP_URL} />
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Preview (dev)</Label>
            <div className="mt-1 flex gap-2">
              <Input readOnly value={MCP_URL_DEV} className="font-mono text-sm" />
              <CopyBtn value={MCP_URL_DEV} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button onClick={testMcp} disabled={testing}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
              Testar conexão
            </Button>
            {lastStatus && (
              <div className="flex items-center gap-2 text-sm">
                {statusOk ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className="font-mono">{lastStatus}</span>
                {lastTested && (
                  <span className="text-muted-foreground">· {new Date(lastTested).toLocaleString("pt-BR")}</span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ferramentas expostas ({TOOLS.length})</CardTitle>
          <CardDescription>
            A IA descobre estas ferramentas automaticamente após conectar ao endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {TOOLS.map((t) => (
              <li key={t.name} className="flex items-start gap-3 py-2.5">
                <code className="mt-0.5 rounded bg-muted px-2 py-0.5 font-mono text-xs">{t.name}</code>
                <span className="text-sm text-muted-foreground">{t.desc}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plataforma da IA (opcional)</CardTitle>
          <CardDescription>
            Registre o painel/webhook da IA para referência. Não afeta a conexão MCP acima.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="api_url">URL do painel ou webhook</Label>
            <Input
              id="api_url"
              placeholder="https://app.mara.ai/..."
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="active"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="active" className="cursor-pointer">
              Integração ativa
            </Label>
          </div>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como configurar na plataforma</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p><strong>1.</strong> Adicione uma nova conexão MCP (ou "ferramenta externa via URL").</p>
          <p><strong>2.</strong> Cole a URL de <strong>Produção</strong> acima.</p>
          <p><strong>3.</strong> Método: <code>POST</code> · Autenticação: <strong>Nenhuma</strong>.</p>
          <p><strong>4.</strong> Salve. A plataforma deve listar automaticamente as 6 ferramentas.</p>
          <p><strong>5.</strong> Volte aqui e clique em <em>Testar conexão</em> para validar.</p>
        </CardContent>
      </Card>
    </div>
  );
}
