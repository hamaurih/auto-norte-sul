import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Calculator, Receipt, ScanLine } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PdvNewSale } from "@/components/pdv/PdvNewSale";
import { PdvSalesHistory } from "@/components/pdv/PdvSalesHistory";
import { PdvCashReport } from "@/components/pdv/PdvCashReport";
import { getPosPermissions } from "@/lib/pos-history.functions";

export const Route = createFileRoute("/_authenticated/admin/pdv")({
  head: () => ({
    meta: [
      { title: "PDV · Norte Sul" },
      {
        name: "description",
        content: "Ponto de venda de balcão: nova venda, histórico e relatório de caixa.",
      },
    ],
  }),
  component: PdvPage,
});

function PdvPage() {
  const permissionsFn = useServerFn(getPosPermissions);
  const [tab, setTab] = useState("nova-venda");

  const permissionsQuery = useQuery({
    queryKey: ["pdv-permissions"],
    queryFn: () => permissionsFn() as Promise<{ role: string | null; canCancel: boolean }>,
    staleTime: 300_000,
  });

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header className="rounded-xl bg-secondary px-4 py-4 text-secondary-foreground shadow">
        <div className="flex items-center gap-2">
          <ScanLine className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl font-black uppercase">PDV Norte Sul</h1>
        </div>
        <p className="text-sm text-secondary-foreground/70">
          Venda rápida de balcão, histórico e conferência de caixa
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="nova-venda">
            <ScanLine className="mr-1 h-4 w-4" /> Nova venda
          </TabsTrigger>
          <TabsTrigger value="historico">
            <Receipt className="mr-1 h-4 w-4" /> Histórico
          </TabsTrigger>
          <TabsTrigger value="caixa">
            <Calculator className="mr-1 h-4 w-4" /> Relatório de caixa
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nova-venda">
          <PdvNewSale />
        </TabsContent>
        <TabsContent value="historico">
          <PdvSalesHistory canCancel={Boolean(permissionsQuery.data?.canCancel)} />
        </TabsContent>
        <TabsContent value="caixa">
          <PdvCashReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
