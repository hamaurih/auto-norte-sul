import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listQuotes, setQuoteStatus } from "@/lib/quotes.functions";
import { brl as formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";

const STATUSES = ["rascunho","enviado","em_negociacao","aprovado","recusado","convertido","expirado"] as const;

export const Route = createFileRoute("/_authenticated/admin/orcamentos")({
  head: () => ({ meta: [{ title: "Orçamentos · Admin" }] }),
  component: OrcamentosPage,
});

function OrcamentosPage() {
  const listFn = useServerFn(listQuotes);
  const setStatusFn = useServerFn(setQuoteStatus);
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const { data } = useQuery({
    queryKey: ["quotes", status],
    queryFn: () => listFn({ data: { status: status || undefined, limit: 200 } }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold uppercase">Orçamentos</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-sm">
          <option value="">Todos os status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {(data ?? []).length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nenhum orçamento ainda. Orçamentos podem chegar via WhatsApp, IA, vendedor, balcão ou B2B.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Nº</th>
                <th className="p-2 text-left">Cliente</th>
                <th className="p-2 text-left">Origem</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-left">Criado</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {data!.map((q: any) => (
                <tr key={q.id} className="border-b border-border last:border-0">
                  <td className="p-2 font-mono">#{q.number}</td>
                  <td className="p-2">{q.customer_name ?? "—"}<div className="text-xs text-muted-foreground">{q.customer_email}</div></td>
                  <td className="p-2 text-xs uppercase">{q.origin}</td>
                  <td className="p-2">
                    <select
                      value={q.status}
                      onChange={async (e) => {
                        await setStatusFn({ data: { id: q.id, status: e.target.value as any } });
                        qc.invalidateQueries({ queryKey: ["quotes"] });
                      }}
                      className="rounded border border-border bg-background px-1 text-xs"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="p-2 text-right font-bold">{formatBRL(q.total ?? 0)}</td>
                  <td className="p-2 text-xs">{new Date(q.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant="ghost" disabled>Ver</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Orçamentos não são pedidos pagos. O módulo de pagamento continua desativado nesta etapa.
      </p>
    </div>
  );
}
