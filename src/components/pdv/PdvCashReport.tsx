import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Calculator, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { brl } from "@/lib/format";
import { getPosCashReport, listPosFilterOptions } from "@/lib/pos-history.functions";
import { paymentLabel } from "@/components/pdv/PdvReceipt";

const ANY = "all";

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function PdvCashReport() {
  const reportFn = useServerFn(getPosCashReport);
  const optionsFn = useServerFn(listPosFilterOptions);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [operatorId, setOperatorId] = useState(ANY);
  const [terminalCode, setTerminalCode] = useState(ANY);

  const filters = useMemo(
    () => ({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      operatorId: operatorId === ANY ? undefined : operatorId,
      terminalCode: terminalCode === ANY ? undefined : terminalCode,
    }),
    [dateFrom, dateTo, operatorId, terminalCode],
  );

  const reportQuery = useQuery({
    queryKey: ["pdv-cash-report", filters],
    queryFn: () => reportFn({ data: filters }) as Promise<any>,
  });

  const optionsQuery = useQuery({
    queryKey: ["pdv-filter-options"],
    queryFn: () => optionsFn() as Promise<any>,
    staleTime: 300_000,
  });

  const sessions = (reportQuery.data?.sessions ?? []) as any[];
  const totals = reportQuery.data?.totals as any;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-display text-lg uppercase">
            <Filter className="h-5 w-5" /> Período e caixa
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div>
            <Label htmlFor="cash-from" className="text-xs uppercase text-muted-foreground">
              De
            </Label>
            <Input
              id="cash-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cash-to" className="text-xs uppercase text-muted-foreground">
              Até
            </Label>
            <Input
              id="cash-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Operador</Label>
            <Select value={operatorId} onValueChange={setOperatorId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todos</SelectItem>
                {((optionsQuery.data?.operators ?? []) as any[]).map((operator) => (
                  <SelectItem key={operator.id} value={operator.id}>
                    {operator.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Terminal</Label>
            <Select value={terminalCode} onValueChange={setTerminalCode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todos</SelectItem>
                {((optionsQuery.data?.terminals ?? []) as string[]).map((terminal) => (
                  <SelectItem key={terminal} value={terminal}>
                    {terminal}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {reportQuery.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : reportQuery.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 text-sm">
          Não foi possível carregar o relatório de caixa.
        </div>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 font-display text-lg uppercase">
                <Calculator className="h-5 w-5" /> Totais do período
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
              {[
                ["Sessões", String(totals?.sessions ?? 0)],
                ["Vendas", String(totals?.sales_count ?? 0)],
                ["Faturamento", brl(totals?.sales_total ?? 0)],
                ["Suprimentos", brl(totals?.supplies ?? 0)],
                ["Sangrias", brl(totals?.withdrawals ?? 0)],
                ["Diferença", brl(totals?.difference ?? 0)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs uppercase text-muted-foreground">{label}</p>
                  <p className="font-display text-xl font-bold">{value}</p>
                </div>
              ))}
              <div className="sm:col-span-3 xl:col-span-6">
                <Separator className="my-2" />
                <div className="flex flex-wrap gap-2">
                  {Object.entries((totals?.by_method ?? {}) as Record<string, number>).map(
                    ([method, value]) => (
                      <Badge key={method} variant="outline">
                        {paymentLabel(method)}: {brl(value)}
                      </Badge>
                    ),
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {sessions.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="font-semibold">Nenhuma sessão de caixa no período</p>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {sessions.map((session) => (
                <Card key={session.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between font-display text-base uppercase">
                      <span>
                        {session.terminal_code || "Terminal"} ·{" "}
                        {session.operator_name || "Operador"}
                      </span>
                      <Badge variant={session.status === "open" ? "outline" : "secondary"}>
                        {session.status === "open" ? "Aberto" : "Fechado"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Abertura</p>
                        <p>{dateTime(session.opened_at)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Fechamento</p>
                        <p>{dateTime(session.closed_at)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Fundo inicial</p>
                        <p>{brl(session.opening_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Vendas</p>
                        <p>
                          {session.sales_count} · {brl(session.sales_total)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Suprimentos</p>
                        <p>{brl(session.supplies)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Sangrias</p>
                        <p>{brl(session.withdrawals)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Esperado</p>
                        <p>{brl(session.expected_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Contado</p>
                        <p>{session.counted_amount === null ? "—" : brl(session.counted_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Diferença</p>
                        <p
                          className={
                            (session.difference_amount ?? 0) < 0
                              ? "font-semibold text-destructive"
                              : "font-semibold"
                          }
                        >
                          {session.difference_amount === null
                            ? "—"
                            : brl(session.difference_amount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Canceladas</p>
                        <p>{session.cancelled_count}</p>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      {Object.entries((session.by_method ?? {}) as Record<string, number>).map(
                        ([method, value]) => (
                          <Badge key={method} variant="outline">
                            {paymentLabel(method)}: {brl(value)}
                          </Badge>
                        ),
                      )}
                    </div>
                    {session.notes ? (
                      <p className="text-xs text-muted-foreground">Obs.: {session.notes}</p>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
