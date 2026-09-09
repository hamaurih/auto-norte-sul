import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, DatabaseZap, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBlingCostRecoveryStatus, syncBlingCostRecoveryBatch } from "@/lib/bling-cost-recovery.functions";
import { qty } from "@/lib/supplies-ui";

export function BlingCostRecoveryPanel() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getBlingCostRecoveryStatus);
  const syncFn = useServerFn(syncBlingCostRecoveryBatch);
  const status = useQuery({
    queryKey: ["bling-cost-recovery-status"],
    queryFn: () => statusFn(),
    staleTime: 15_000,
  });

  const recovery = useMutation({
    mutationFn: async () => {
      const total = {
        pagesProcessed: 0,
        linksRead: 0,
        matchedProducts: 0,
        candidatesCreated: 0,
        candidatesUpdated: 0,
        ambiguous: 0,
      };
      let completed = false;
      let lastMessage = "";
      for (let batch = 0; batch < 20; batch += 1) {
        const result = await syncFn({ data: { maxPages: 10 } });
        total.pagesProcessed += Number(result.pagesProcessed ?? 0);
        total.linksRead += Number(result.linksRead ?? 0);
        total.matchedProducts += Number(result.matchedProducts ?? 0);
        total.candidatesCreated += Number(result.candidatesCreated ?? 0);
        total.candidatesUpdated += Number(result.candidatesUpdated ?? 0);
        total.ambiguous += Number(result.ambiguous ?? 0);
        lastMessage = result.message ?? lastMessage;
        if (result.cycleCompleted) {
          completed = true;
          break;
        }
      }
      if (!completed) throw new Error("O ciclo atingiu o limite de segurança. Clique novamente para continuar do cursor salvo.");
      return { ...total, completed, lastMessage };
    },
    onSuccess: async (result) => {
      toast.success(`Bling analisado: ${result.candidatesCreated + result.candidatesUpdated} candidatos de custo preparados.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["bling-cost-recovery-status"] }),
        qc.invalidateQueries({ queryKey: ["cost-sanitation"] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = status.data;
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-bold text-primary">
            <DatabaseZap className="h-5 w-5" /> Recuperação automática pelo Bling
          </div>
          <h2 className="mt-2 text-xl font-bold">Trazer custo real sem devolver o Bling ao comando do ERP</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Consulta os vínculos produto-fornecedor e cruza preço de custo com preço de compra. O valor vira candidato auditável e só entra no produto depois da barreira de qualidade e da aprovação gerencial.
          </p>
        </div>
        <Button disabled={recovery.isPending || status.isLoading || data?.connected === false} onClick={() => recovery.mutate()}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${recovery.isPending ? "animate-spin" : ""}`} />
          {recovery.isPending ? "Recuperando custos…" : "Recuperar custos do Bling"}
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label="Produtos ativos" value={qty(data?.totalProducts ?? 0)} />
        <Metric label="Com custo aprovado" value={qty(data?.withCost ?? 0)} good={(data?.withCost ?? 0) > 0} />
        <Metric label="Sem custo" value={qty(data?.missingCost ?? 0)} danger={(data?.missingCost ?? 0) > 0} />
        <Metric label="Aptos p/ aprovar" value={qty(data?.eligibleBling ?? 0)} good={(data?.eligibleBling ?? 0) > 0} />
        <Metric label="Retidos p/ revisão" value={qty(data?.reviewBling ?? 0)} danger={(data?.reviewBling ?? 0) > 0} />
        <Metric label="Sem vínculo/custo" value={qty(data?.ambiguousBling ?? 0)} danger={(data?.ambiguousBling ?? 0) > 0} />
      </div>

      {data?.connected === false ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Reautorize o Bling antes da recuperação de custos.
        </div>
      ) : null}
      {(data?.eligibleBling ?? 0) > 0 ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> {qty(data?.eligibleBling ?? 0)} custos passaram pela validação cruzada e estão aptos à aprovação gerencial em lote.
        </div>
      ) : null}
      {data?.lastStatus === "sucesso" && data?.lastMessage ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {data.lastMessage}
        </div>
      ) : null}
      {data?.lastStatus === "erro" && data?.lastMessage ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {data.lastMessage}
        </div>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Regra automática: vínculo selecionado + concordância entre preço de custo e preço de compra em até 5% + teste de plausibilidade. Divergências ficam bloqueadas para nova evidência ou custo manual; preço de venda nunca é alterado automaticamente.
      </p>
    </section>
  );
}

function Metric({ label, value, good = false, danger = false }: { label: string; value: string; good?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold ${danger ? "text-red-700" : good ? "text-emerald-700" : ""}`}>{value}</p>
    </div>
  );
}