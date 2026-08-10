import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Filter, Receipt, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { brl } from "@/lib/format";
import { listPosFilterOptions, listPosSales } from "@/lib/pos-history.functions";
import { paymentLabel, paymentMethodLabels } from "@/components/pdv/PdvReceipt";
import {
  PdvSaleDetailSheet,
  statusLabels,
  statusVariant,
} from "@/components/pdv/PdvSaleDetailSheet";

const ANY = "all";
const PAGE_SIZE = 20;

export function PdvSalesHistory({ canCancel }: { canCancel: boolean }) {
  const salesFn = useServerFn(listPosSales);
  const optionsFn = useServerFn(listPosFilterOptions);

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState(ANY);
  const [operatorId, setOperatorId] = useState(ANY);
  const [terminalCode, setTerminalCode] = useState(ANY);
  const [paymentMethod, setPaymentMethod] = useState(ANY);
  const [page, setPage] = useState(1);
  const [selectedSale, setSelectedSale] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      search: search.trim() || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      status: status === ANY ? undefined : status,
      operatorId: operatorId === ANY ? undefined : operatorId,
      terminalCode: terminalCode === ANY ? undefined : terminalCode,
      paymentMethod: paymentMethod === ANY ? undefined : paymentMethod,
    }),
    [page, search, dateFrom, dateTo, status, operatorId, terminalCode, paymentMethod],
  );

  const salesQuery = useQuery({
    queryKey: ["pdv-sales", filters],
    queryFn: () => salesFn({ data: filters }) as Promise<any>,
  });

  const optionsQuery = useQuery({
    queryKey: ["pdv-filter-options"],
    queryFn: () => optionsFn() as Promise<any>,
    staleTime: 300_000,
  });

  const rows = (salesQuery.data?.rows ?? []) as any[];
  const total = Number(salesQuery.data?.total ?? 0);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(1);
      setter(value);
    };
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-display text-lg uppercase">
            <Filter className="h-5 w-5" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="md:col-span-3 xl:col-span-2">
            <Label htmlFor="sale-search" className="text-xs uppercase text-muted-foreground">
              Buscar por código ou cliente
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="sale-search"
                value={search}
                onChange={(event) => resetPage(setSearch)(event.target.value)}
                placeholder="Código da venda, nome ou documento"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="date-from" className="text-xs uppercase text-muted-foreground">
              De
            </Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => resetPage(setDateFrom)(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="date-to" className="text-xs uppercase text-muted-foreground">
              Até
            </Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(event) => resetPage(setDateTo)(event.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Status</Label>
            <Select value={status} onValueChange={resetPage(setStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todos</SelectItem>
                {["completed", "cancelled", "refunded"].map((value) => (
                  <SelectItem key={value} value={value}>
                    {statusLabels[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Operador</Label>
            <Select value={operatorId} onValueChange={resetPage(setOperatorId)}>
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
            <Select value={terminalCode} onValueChange={resetPage(setTerminalCode)}>
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
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Pagamento</Label>
            <Select value={paymentMethod} onValueChange={resetPage(setPaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Todos</SelectItem>
                {Object.keys(paymentMethodLabels).map((method) => (
                  <SelectItem key={method} value={method}>
                    {paymentLabel(method)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between font-display text-lg uppercase">
            <span className="flex items-center gap-2">
              <Receipt className="h-5 w-5" /> Histórico de vendas
            </span>
            <Badge variant="secondary">{total} vendas</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {salesQuery.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : salesQuery.isError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 text-sm">
              Não foi possível carregar o histórico de vendas.
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="font-semibold">Nenhuma venda encontrada</p>
              <p className="text-sm text-muted-foreground">Ajuste os filtros ou o período.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Operador</TableHead>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((sale) => (
                    <TableRow
                      key={sale.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedSale(sale.id)}
                    >
                      <TableCell className="font-mono font-semibold">{sale.code}</TableCell>
                      <TableCell>
                        {new Date(sale.created_at).toLocaleString("pt-BR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell>{sale.customer_name || "Consumidor"}</TableCell>
                      <TableCell>{sale.operator_name || "—"}</TableCell>
                      <TableCell>{sale.terminal_code || "—"}</TableCell>
                      <TableCell>
                        {(sale.payment_methods ?? []).map(paymentLabel).join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(sale.status)}>
                          {statusLabels[sale.status] ?? sale.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{brl(sale.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Página {page} de {lastPage}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
                onClick={() => setPage((value) => Math.min(lastPage, value + 1))}
              >
                Próxima <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <PdvSaleDetailSheet
        saleId={selectedSale}
        canCancel={canCancel}
        onOpenChange={(open) => {
          if (!open) setSelectedSale(null);
        }}
        onCancelled={() => salesQuery.refetch()}
      />
    </div>
  );
}
