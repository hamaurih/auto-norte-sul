import { useEffect, useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TaxProductScenarios } from "@/components/admin/TaxProductScenarios";
import { taxMigrationMode, tax_migration_preview, TAX_GO_LIVE } from "@/lib/tax-migration";

export const Route = createFileRoute("/_authenticated/admin/migracao-tributaria")({
  beforeLoad: () => {
    if (!tax_migration_preview) throw notFound();
  },
  head: () => ({ meta: [{ title: "Migração IBS/CBS · Norte Sul" }] }),
  component: TaxMigrationPage,
});

function TaxMigrationPage() {
  return <TaxMigrationPreview />;
}

function TaxMigrationPreview() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const mode = now === null ? "demo" : taxMigrationMode(now);
  const remaining = Math.max(0, TAX_GO_LIVE - (now ?? TAX_GO_LIVE));
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor(remaining / 3_600_000) % 24;
  const minutes = Math.floor(remaining / 60_000) % 60;
  const seconds = Math.floor(remaining / 1000) % 60;

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
      <TaxProductScenarios />
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
    </div>
  );
}
