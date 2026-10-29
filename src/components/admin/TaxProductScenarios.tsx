import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTaxCatalog } from "@/lib/tax-product-scenarios.functions";
import {
  classifyProduct,
  simulateProduct,
  summarizeCatalog,
  UFS,
} from "@/lib/tax-product-scenarios";
import type { Channel, TaxOptions } from "@/lib/tax-product-scenarios";
const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const field = "rounded border bg-background p-2";
export function TaxProductScenarios() {
  const load = useServerFn(getTaxCatalog);
  const query = useQuery({ queryKey: ["tax-scenario-catalog"], queryFn: () => load() });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [page, setPage] = useState(0);
  const [options, setOptions] = useState<TaxOptions>({
    channel: "counter",
    uf: "PB",
    internalRate: 20,
    povertyRate: 0,
    protocol: false,
    mva: null,
  });
  const [overrides, setOverrides] = useState<Record<string, Partial<TaxOptions>>>({});
  const products = useMemo(() => query.data ?? [], [query.data]);
  const summary = useMemo(
    () => summarizeCatalog(products, options, overrides),
    [products, options, overrides],
  );
  const filtered = products.filter(
    (p) =>
      (!selected || p.id === selected) &&
      `${p.name} ${p.sku} ${p.profile?.ncm ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  const update = (patch: Partial<TaxOptions>) => setOptions((o) => ({ ...o, ...patch }));
  return (
    <section className="space-y-5" aria-label="Cenários fiscais por produto">
      <div className="rounded-xl border bg-muted/40 p-5 space-y-2">
        <h2 className="text-xl font-bold">Resumo geral · catálogo inteiro</h2>
        <p>
          {products.length} produtos · {summary.count} calculáveis · {summary.pending} pendentes ·{" "}
          {products.filter((p) => classifyProduct(p)?.autoParts).length} CEST 01 ·{" "}
          {products.filter((p) => classifyProduct(p)?.monophase).length} monofásicos
        </p>
        <p>
          Média simples de retenção: HOJE{" "}
          {summary.today === null
            ? "—"
            : `${pct(summary.today)} / ${money(summary.retainedToday!)}`}{" "}
          · 2027{" "}
          {summary.future === null
            ? "—"
            : `${pct(summary.future)} / ${money(summary.retainedFuture!)}`}
        </p>
        <p className="text-sm text-muted-foreground">
          Uma unidade por produto calculável; sem ponderação por vendas. Pendentes excluídos da
          média. Busca e seleção não alteram o resumo. Valores são reserva estimada de tributos, não
          retenção bancária atual.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1">
          Canal
          <select
            className={field}
            value={options.channel}
            onChange={(e) => {
              const channel = e.target.value as Channel;
              update({
                channel,
                uf: channel === "counter" || channel === "online-pb" ? "PB" : "SP",
              });
            }}
          >
            <option value="counter">Balcão PB</option>
            <option value="online-pb">Online PB</option>
            <option value="b2c">Online B2C outro estado</option>
            <option value="b2b">B2B outro estado</option>
          </select>
        </label>
        <label className="grid gap-1">
          UF destino
          <select
            className={field}
            value={options.uf}
            disabled={options.channel === "counter" || options.channel === "online-pb"}
            onChange={(e) => update({ uf: e.target.value })}
          >
            {UFS.map((uf) => (
              <option
                key={uf}
                disabled={uf === "PB" && (options.channel === "b2c" || options.channel === "b2b")}
              >
                {uf}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Interna destino (%) · confirmar por produto
          <input
            className={field}
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={Number.isNaN(options.internalRate) ? "" : options.internalRate}
            onChange={(e) =>
              update({ internalRate: e.target.value === "" ? NaN : Number(e.target.value) })
            }
          />
        </label>
        <label className="grid gap-1">
          Fundo de pobreza destino (%)
          <input
            className={field}
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={Number.isNaN(options.povertyRate) ? "" : options.povertyRate}
            onChange={(e) =>
              update({ povertyRate: e.target.value === "" ? NaN : Number(e.target.value) })
            }
          />
        </label>
        {options.channel === "b2b" && (
          <>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={options.protocol}
                onChange={(e) => update({ protocol: e.target.checked })}
              />
              Protocolo ST aplicável (confirmado)
            </label>
            <label className="grid gap-1">
              MVA do protocolo (%)
              <input
                className={field}
                type="number"
                min="0"
                max="1000"
                value={options.mva ?? ""}
                onChange={(e) =>
                  update({ mva: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </label>
          </>
        )}
      </div>
      <p className="text-sm">
        UF não preenche alíquota automaticamente: confirme interna e FCP aplicáveis ao item no
        destino. B2C: 12% + DIFAL = interna − 12% + FCP. B2B: 12% + ST somente com protocolo e MVA
        informados. Sem créditos, frete ou base dupla. Premissa: revenda nacional em regime normal;
        importação/industrialização e IPI exigem análise própria.
      </p>
      <p className="text-sm">
        2027: CBS geral 11,2% + IBS destino 0,1%, sem redução de 60%; PIS/Cofins substituídos e
        ICMS/ST mantidos na transição. Premissa de planejamento de 29/10/2026, sujeita à definição
        legal. Teste 2026: CBS 0,9% + IBS 0,1%, mostrado à parte por dispensa/compensação.
      </p>
      <div className="flex flex-wrap gap-3">
        <label>
          Buscar produto
          <input
            className={field + " ml-2"}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Selecionar produto
          <select
            className={field + " ml-2 max-w-xs"}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {query.isPending && <p role="status">Carregando catálogo completo…</p>}
      {query.isError && (
        <p role="alert">
          Não foi possível carregar: {query.error.message}{" "}
          <button className="underline" onClick={() => query.refetch()}>
            Tentar novamente
          </button>
        </p>
      )}
      {!query.isPending && !query.isError && !filtered.length && <p>Nenhum produto encontrado.</p>}
      {filtered.slice(page * 20, page * 20 + 20).map((p) => {
        const itemOptions = { ...options, ...overrides[p.id] };
        const s = simulateProduct(p, itemOptions);
        return (
          <article key={p.id} className="rounded-xl border p-4 space-y-3">
            <h3 className="font-bold">
              {p.name} · {p.sku}
            </h3>
            <p className="text-sm">
              NCM {p.profile?.ncm || "pendente"} · CEST {p.profile?.cest || "não informado"} ·{" "}
              {classifyProduct(p)?.label ?? "Classificação pendente"}
            </p>
            {(options.channel === "b2c" || options.channel === "b2b") && (
              <div className="flex flex-wrap gap-3 text-sm">
                {(
                  [
                    "internalRate",
                    "povertyRate",
                    ...(options.channel === "b2b" ? ["mva"] : []),
                  ] as const
                ).map((key) => (
                  <label key={key}>
                    {key === "internalRate"
                      ? "Interna deste produto (%)"
                      : key === "povertyRate"
                        ? "FCP deste produto (%)"
                        : "MVA deste produto (%)"}
                    <input
                      className={field + " ml-2 w-24"}
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        Number.isNaN(itemOptions[key as keyof TaxOptions])
                          ? ""
                          : (itemOptions[key as "internalRate" | "povertyRate" | "mva"] ?? "")
                      }
                      onChange={(e) =>
                        setOverrides((v) => ({
                          ...v,
                          [p.id]: {
                            ...v[p.id],
                            [key]: e.target.value === "" ? NaN : Number(e.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                ))}
                <button
                  className="underline"
                  onClick={() =>
                    setOverrides((v) => {
                      const next = { ...v };
                      delete next[p.id];
                      return next;
                    })
                  }
                >
                  Usar parâmetros gerais
                </button>
              </div>
            )}
            {s.pending !== null ? (
              <p role="status">
                Pendente: {s.pending}. Revise o perfil fiscal aprovado; nenhuma alíquota genérica
                foi atribuída.
              </p>
            ) : (
              <>
                <p>
                  Preço final atual: {money(s.price)} · custo:{" "}
                  {p.average_cost === null ? "não cadastrado" : money(p.average_cost)}
                </p>
                <div className="overflow-x-auto">
                  <div className="grid min-w-[660px] grid-cols-3 gap-3">
                    <div className="rounded border p-3">
                      <h4 className="font-bold">HOJE</h4>
                      <p>
                        {pct(s.todayRate)} · retido {money(s.today)}
                      </p>
                      <p className="text-sm">
                        ICMS {pct(s.icms)} · DIFAL/FCP {pct(s.difal)} · ST {pct(s.st)} · PIS/Cofins{" "}
                        {pct(s.federal)}
                      </p>
                      <p>
                        Lucro após impostos:{" "}
                        {s.profitToday === null ? "custo pendente" : money(s.profitToday)}
                      </p>
                    </div>
                    <div className="rounded border p-3">
                      <h4 className="font-bold">2027 reforma</h4>
                      <p>
                        {pct(s.futureRate)} · retido {money(s.future)}
                      </p>
                      <p>
                        CBS {pct(s.cbs)} + IBS {pct(s.ibs)} + ICMS/DIFAL/ST
                      </p>
                      <p>
                        Lucro após impostos:{" "}
                        {s.profitFuture === null ? "custo pendente" : money(s.profitFuture)}
                      </p>
                    </div>
                    <div className="rounded border p-3">
                      <h4 className="font-bold">Split Payment</h4>
                      <p className="font-semibold">
                        Alíquota deste produto na liquidação: {pct(s.splitRate)}
                      </p>
                      <p>Valor retido na hora da venda: {money(s.split)}</p>
                      <p className="font-bold">Cai na conta do vendedor: {money(s.deposit)}</p>
                      <p className="text-sm">
                        Somente CBS/IBS segregados. Após reservar ICMS/DIFAL/ST:{" "}
                        {money(s.netAfterTaxes)}. Não é imposto adicional.
                      </p>
                    </div>
                  </div>
                </div>
                {s.delta !== 0 && (
                  <p role="status" className="font-semibold text-amber-700">
                    Alerta: {s.delta > 0 ? "subiu" : "caiu"}{" "}
                    {Math.abs(s.delta).toLocaleString("pt-BR")} p.p. em 2027
                    {s.todayRate > 0
                      ? ` (${pct(Math.abs((s.delta / s.todayRate) * 100))} de variação relativa)`
                      : ""}{" "}
                    · diferença {money(s.future - s.today)} por unidade.
                  </p>
                )}
                <p>
                  <strong>Impacto no preço final / margem:</strong> imposto 2027 consome{" "}
                  {money(s.future)} do lucro bruto{" "}
                  {s.grossProfit === null ? "(custo pendente)" : money(s.grossProfit)}
                  {s.profitConsumed === null
                    ? "; percentual indisponível sem lucro bruto positivo"
                    : ` (${pct(s.profitConsumed)})`}
                  . Preço para preservar o lucro líquido de hoje: {money(s.preservePrice)}.
                </p>
                <p className="text-sm">
                  Teste 2026: {money(s.test2026)} (1%), não somado à carga de hoje. ST anterior está
                  no custo de aquisição quando corretamente cadastrado; não é retida novamente na
                  revenda PB.
                </p>
              </>
            )}
          </article>
        );
      })}
      <div className="flex items-center gap-4">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </button>
        <span>
          {filtered.length} resultados · página {page + 1}
        </span>
        <button disabled={(page + 1) * 20 >= filtered.length} onClick={() => setPage((p) => p + 1)}>
          Próxima
        </button>
      </div>
      <p className="text-sm">
        Fontes:{" "}
        <a
          className="underline"
          href="https://www.sefaz.pb.gov.br/legislacao/99-regulamentos/anexos-icms/8975-produtos-substituicao-tributaria-9"
        >
          SEFAZ PB · autopeças/ST
        </a>{" "}
        ·{" "}
        <a className="underline" href="https://www.planalto.gov.br/ccivil_03/leis/2002/l10485.htm">
          Lei 10.485 · anexos I/II
        </a>{" "}
        ·{" "}
        <a
          className="underline"
          href="https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria-do-consumo/entenda"
        >
          Receita Federal · transição
        </a>
        . Monofásico identificado pelos CST 04 de PIS e Cofins aprovados no produto; CEST 01 sozinho
        não comprova enquadramento nos anexos.
      </p>
    </section>
  );
}
