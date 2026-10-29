import { useEffect, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useSession } from "@/lib/session";
import {
  simulateTaxPrice,
  taxMigrationMode,
  tax_migration_preview,
  TAX_GO_LIVE,
} from "@/lib/tax-migration";

export const Route = createFileRoute("/_authenticated/admin/migracao-tributaria")({
  beforeLoad: () => {
    if (!tax_migration_preview) throw notFound();
  },
  head: () => ({ meta: [{ title: "Migração IBS/CBS · Norte Sul" }] }),
  component: TaxMigrationPage,
});

const tasks = [
  ["nfe", "Campos IBS/CBS na NF-e"],
  ["operation", "Cálculo por operação"],
  ["ibge", "Destino IBGE"],
  ["split", "Split payment"],
  ["marketplace", "Marketplace / responsabilidade solidária"],
] as const;
const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function TaxMigrationPage() {
  const { isAdmin, user } = useSession();
  if (!isAdmin)
    return <p className="p-6 text-muted-foreground">Acesso restrito ao administrador.</p>;
  return (
    <TaxMigrationPreview
      key={user?.id}
      storageKey={`tax-migration-checklist:v1:${user?.id ?? "admin"}`}
    />
  );
}

function TaxMigrationPreview({ storageKey }: { storageKey: string }) {
  const [now, setNow] = useState<number | null>(null);
  const [price, setPrice] = useState("100.00");
  const [checked, setChecked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(stored))
        setChecked(tasks.map(([id]) => id).filter((id) => stored.includes(id)));
    } catch {
      setStorageError(true);
    }
    setReady(true);
    return () => window.clearInterval(timer);
  }, [storageKey]);
  const mode = now === null ? "demo" : taxMigrationMode(now);
  const remaining = Math.max(0, TAX_GO_LIVE - (now ?? TAX_GO_LIVE));
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor(remaining / 3_600_000) % 24;
  const minutes = Math.floor(remaining / 60_000) % 60;
  const seconds = Math.floor(remaining / 1000) % 60;
  const simulation = price.trim() === "" ? null : simulateTaxPrice(Number(price));
  const toggle = (id: string, value: boolean) => {
    const next = value
      ? [...checked.filter((item) => item !== id), id]
      : checked.filter((item) => item !== id);
    setChecked(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-8">
      <header className="space-y-2">
        <Badge variant="secondary">
          {mode === "effective" ? "Efetivo · somente UI" : "Demonstração / exemplo"}
        </Badge>
        <h1 className="font-display text-2xl font-bold">Migração IBS/CBS</h1>
        <p className="text-sm text-muted-foreground">
          Planejamento tributário local. Nenhuma cobrança, emissão fiscal ou alteração de preços é
          realizada por esta página.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Fase de migração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-lg font-semibold">
            {now === null
              ? "Carregando contagem…"
              : remaining > 0
                ? `${days} dias · ${hours}h ${minutes}min ${seconds}s`
                : "Marco de 2027 alcançado"}
          </p>
          <p className="text-sm text-muted-foreground">
            Até 01/01/2027, 00h de Brasília — marco da CBS efetiva. Em 2026, o modo é sempre
            demonstração. Após essa data, a flag pode habilitar o modo efetivo apenas visual; a
            passagem do tempo não habilita cobrança.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Simulador de preço ao cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm space-y-2">
            <label htmlFor="tax-price" className="text-sm font-medium">
              Preço base do exemplo (R$)
            </label>
            <Input
              id="tax-price"
              type="number"
              inputMode="decimal"
              min="0"
              max="1000000000"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              aria-describedby="tax-assumption"
            />
          </div>
          <p id="tax-assumption" className="text-sm text-muted-foreground">
            Hipótese didática: preço final = base + tributos destacados. Não considera créditos,
            regimes especiais ou substituição de PIS/Cofins; não representa o reajuste tributário
            real. Em 2027, o exemplo considera somente CBS, sem estimar IBS.
          </p>
          {simulation ? (
            <div className="grid gap-4 md:grid-cols-2" aria-live="polite">
              <div className="space-y-2 rounded-xl border p-4">
                <h2 className="font-semibold">2026 · informativo</h2>
                <p>CBS 0,9%: {money(simulation.cbs2026)}</p>
                <p>IBS 0,1%: {money(simulation.ibs2026)}</p>
                <p className="font-bold">Preço final ilustrativo: {money(simulation.total2026)}</p>
                <p className="text-sm">
                  Impacto sobre a base: +{money(simulation.cbs2026 + simulation.ibs2026)} (1%)
                </p>
              </div>
              <div className="space-y-2 rounded-xl border p-4">
                <h2 className="font-semibold">2027 · referência</h2>
                <p>CBS 11,3%: {money(simulation.cbs2027)}</p>
                <p className="font-bold">Preço final ilustrativo: {money(simulation.total2027)}</p>
                <p className="text-sm">
                  Impacto sobre a base: +{money(simulation.cbs2027)} (11,3%)
                </p>
              </div>
              <p className="text-sm md:col-span-2">
                Diferença ilustrativa entre cenários:{" "}
                {money(simulation.total2027 - simulation.total2026)}.
              </p>
            </div>
          ) : (
            <p role="alert" className="text-sm text-destructive">
              Informe um preço válido entre R$ 0 e R$ 1 bilhão.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            CBS 11,3%: referência TCU de 28/10/2026, sujeita à fixação por resolução do Senado.{" "}
            <a
              className="underline"
              href="https://portal.tcu.gov.br/imprensa/noticias/tcu-calcula-aliquota-de-referencia-de-113-para-novo-tributo-sobre-consumo"
              target="_blank"
              rel="noreferrer"
            >
              Consultar fonte TCU
            </a>
            .
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Checklist de preparação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {checked.length} de {tasks.length} concluídos. Salvo neste navegador por administrador.
            Marcações manuais de planejamento; não validam integrações.
          </p>
          <Progress
            value={(checked.length / tasks.length) * 100}
            aria-label="Preparação concluída"
          />
          {tasks.map(([id, label]) => (
            <label
              key={id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border p-3"
            >
              <Checkbox
                disabled={!ready}
                checked={checked.includes(id)}
                onCheckedChange={(value) => toggle(id, value === true)}
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
          {storageError && (
            <p role="status" className="text-sm text-destructive">
              Não foi possível acessar o armazenamento local. As marcações podem ser perdidas ao
              sair.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
