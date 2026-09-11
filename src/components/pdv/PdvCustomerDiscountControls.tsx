import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BadgePercent,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getPdvCommercialRules,
  searchPdvCustomers,
  type PdvCommercialRules,
  type PdvCustomer,
} from "@/lib/pos.functions";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function PdvCustomerDiscountControls({
  subtotal,
  customer,
  onCustomerChange,
  discountAmount,
  onDiscountAmountChange,
}: {
  subtotal: number;
  customer: PdvCustomer | null;
  onCustomerChange: (customer: PdvCustomer | null) => void;
  discountAmount: number;
  onDiscountAmountChange: (amount: number) => void;
}) {
  const rulesFn = useServerFn(getPdvCommercialRules);
  const customerFn = useServerFn(searchPdvCustomers);

  const [rules, setRules] = useState<PdvCommercialRules | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PdvCustomer[]>([]);
  const [searching, setSearching] = useState(false);
  const [discountPct, setDiscountPct] = useState("0");

  useEffect(() => {
    let active = true;
    void rulesFn()
      .then((value) => {
        if (active) setRules(value as PdvCommercialRules);
      })
      .catch((error) => {
        if (active) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Não foi possível carregar as regras comerciais do PDV",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [rulesFn]);

  useEffect(() => {
    const raw = search.trim();
    if (customer || raw.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void customerFn({ data: { search: raw } })
        .then((rows) => {
          if (active) setResults(rows as PdvCustomer[]);
        })
        .catch(() => {
          if (active) setResults([]);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, customer, customerFn]);

  useEffect(() => {
    if (subtotal <= 0) {
      setDiscountPct("0");
      onDiscountAmountChange(0);
      return;
    }

    const expectedPct = (discountAmount / subtotal) * 100;
    const currentPct = Number(discountPct.replace(",", ".")) || 0;
    if (Math.abs(expectedPct - currentPct) > 0.011) {
      setDiscountPct(
        expectedPct > 0
          ? expectedPct.toFixed(2).replace(".", ",")
          : "0",
      );
    }
  }, [subtotal, discountAmount]);

  const maxDiscountPct = Math.max(0, Math.min(100, rules?.maxDiscountPct ?? 0));
  const discountDisabled = !rules || (!rules.managerOverride && maxDiscountPct <= 0);

  const limitValue = useMemo(
    () => Math.round((subtotal * maxDiscountPct / 100) * 100) / 100,
    [subtotal, maxDiscountPct],
  );

  function applyDiscount(raw: string) {
    setDiscountPct(raw);

    const parsed = Number(raw.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      onDiscountAmountChange(0);
      return;
    }

    const bounded = Math.min(parsed, maxDiscountPct, 100);
    const amount = Math.round((subtotal * bounded / 100) * 100) / 100;
    onDiscountAmountChange(amount);
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border bg-background p-3">
        <Label className="mb-2 flex items-center gap-2 text-xs uppercase text-muted-foreground">
          <UserRound className="h-4 w-4" />
          Cliente
        </Label>

        {customer ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {customer.trade_name || customer.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[customer.document, customer.phone].filter(Boolean).join(" · ") || "Cliente identificado"}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Remover cliente da venda"
              onClick={() => {
                onCustomerChange(null);
                setSearch("");
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="Nome, CPF/CNPJ ou telefone"
              autoComplete="off"
            />

            {search.trim().length >= 2 ? (
              <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
                {searching ? (
                  <p className="p-3 text-sm text-muted-foreground">Buscando cliente…</p>
                ) : results.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Nenhum cliente encontrado.</p>
                ) : (
                  results.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-muted"
                      onClick={() => {
                        onCustomerChange(row);
                        setSearch("");
                        setResults([]);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {row.trade_name || row.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[row.document, row.phone].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {row.customer_group ? (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {row.customer_group}
                        </Badge>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        )}

        <p className="mt-2 text-[11px] text-muted-foreground">
          Consumidor não identificado continua permitido.
        </p>
      </div>

      <div className="rounded-xl border bg-background p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Label htmlFor="pdv-discount" className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <BadgePercent className="h-4 w-4" />
            Desconto
          </Label>
          <Badge variant="outline" className="text-[10px]">
            Limite {maxDiscountPct.toFixed(2).replace(".", ",")}%
          </Badge>
        </div>

        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <div className="relative">
            <Input
              id="pdv-discount"
              inputMode="decimal"
              value={discountPct}
              disabled={discountDisabled || subtotal <= 0}
              onChange={(event) => applyDiscount(event.target.value)}
              onBlur={() => {
                const parsed = Number(discountPct.replace(",", ".")) || 0;
                if (parsed > maxDiscountPct) {
                  setDiscountPct(maxDiscountPct.toFixed(2).replace(".", ","));
                  onDiscountAmountChange(limitValue);
                  toast.error(
                    `Desconto ajustado ao seu limite de ${maxDiscountPct.toFixed(2).replace(".", ",")}%.`,
                  );
                }
              }}
              className="pr-8"
              aria-describedby="pdv-discount-help"
            />
            <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">%</span>
          </div>
          <strong className="min-w-24 text-right text-sm">
            - {money.format(discountAmount)}
          </strong>
        </div>

        <p id="pdv-discount-help" className="mt-2 text-[11px] text-muted-foreground">
          {rules?.managerOverride
            ? "Perfil de gestão. O servidor ainda valida o valor final da venda."
            : maxDiscountPct > 0
              ? "O limite configurado para este vendedor é validado novamente no servidor."
              : "Seu perfil não possui desconto liberado."}
        </p>
      </div>
    </div>
  );
}
