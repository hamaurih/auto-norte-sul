import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import {
  integrationToggleActive,
  integrationTestConnection,
  listIntegrations,
} from "@/lib/integrations.functions";
import {
  Boxes,
  Store,
  ShoppingCart,
  Package2,
  Music2,
  Truck,
  CreditCard,
  MessageCircle,
  ShoppingBag,
  BarChart3,
  Bot,
  FileText,
  Smartphone,
  Settings2,
  Plug,
  FileWarning,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/ecossistema/")({
  component: EcossistemaIndex,
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

const iconBySlug: Record<string, LucideIcon> = {
  bling: Boxes,
  "mercado-livre": Store,
  shopee: ShoppingBag,
  amazon: Package2,
  "tiktok-shop": Music2,
  "melhor-envio": Truck,
  "mercado-pago": CreditCard,
  whatsapp: MessageCircle,
  "google-merchant": ShoppingCart,
  "meta-capi": BarChart3,
  "ia-aes-business": Bot,
  fiscal: FileText,
  "mobile-app": Smartphone,
};

const categoryLabels: Record<string, string> = {
  erp: "ERP",
  marketplace: "Marketplace",
  ecommerce: "E-commerce",
  logistics: "Logística",
  payment: "Pagamento",
  fiscal: "Fiscal",
  ai: "IA",
  marketing: "Marketing",
  mobile: "Mobile",
};

const statusMeta: Record<Integration["status"], { label: string; className: string }> = {
  connected: { label: "Conectado", className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  disconnected: { label: "Desconectado", className: "bg-muted text-muted-foreground border-border" },
  error: { label: "Erro", className: "bg-destructive/10 text-destructive border-destructive/30" },
  configuring: { label: "Em configuração", className: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
};

function formatDate(iso: string | null) {
  if (!iso) return "Nunca";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function EcossistemaIndex() {
  const qc = useQueryClient();
  const listFn = useServerFn(listIntegrations);
  const { data, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => listFn(),
  });

  const testFn = useServerFn(integrationTestConnection);
  const toggleFn = useServerFn(integrationToggleActive);

  const test = useMutation({
    mutationFn: (i: Integration) => testFn({ data: { id: i.id, slug: i.slug } }),
    onSuccess: (r) => {
      toast.success("Teste registrado", { description: (r as any)?.message });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao testar"),
  });

  const toggle = useMutation({
    mutationFn: (i: Integration) => toggleFn({ data: { id: i.id, active: !i.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
    onError: (e: any) => toast.error(e.message ?? "Falha"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando integrações…</p>;

  const grouped = (data ?? []).reduce<Record<string, Integration[]>>((acc, i) => {
    (acc[i.category] ||= []).push(i);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Hub central para conectar, configurar, testar e monitorar todas as integrações externas do sistema.
      </p>
      {Object.entries(grouped).map(([cat, list]) => (
        <section key={cat}>
          <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {categoryLabels[cat] ?? cat}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((i) => {
              const Icon = iconBySlug[i.slug] ?? Plug;
              const s = statusMeta[i.status];
              return (
                <Card key={i.id} className="flex flex-col">
                  <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                    <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="truncate font-display text-base font-bold uppercase">{i.name}</h3>
                        <Badge variant="outline" className={s.className}>{s.label}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{i.description}</p>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 pb-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Última sincronização</span>
                      <span className="font-mono">{formatDate(i.last_sync_at)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Ativo</span>
                      <span className={i.active ? "font-semibold text-emerald-600" : "text-muted-foreground"}>
                        {i.active ? "Sim" : "Não"}
                      </span>
                    </div>
                  </CardContent>
                  <CardFooter className="flex flex-wrap gap-2 border-t pt-3">
                    <Button asChild size="sm" variant="default">
                      <Link to="/admin/ecossistema/$slug" params={{ slug: i.slug }}>
                        <Settings2 className="mr-1 h-3.5 w-3.5" /> Configurar
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => test.mutate(i)}
                      disabled={test.isPending}
                    >
                      <FileWarning className="mr-1 h-3.5 w-3.5" /> Testar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggle.mutate(i)}
                      disabled={toggle.isPending}
                    >
                      {i.active ? "Desativar" : "Ativar"}
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/admin/ecossistema/$slug" params={{ slug: i.slug }} search={{ tab: "logs" } as any}>
                        Logs
                      </Link>
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
