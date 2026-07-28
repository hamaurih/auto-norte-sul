import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCatalogAudit, getBlingAudit, getAiAudit } from "@/lib/audit.functions";

export const Route = createFileRoute("/_authenticated/admin/auditoria")({
  head: () => ({ meta: [{ title: "Auditoria Operacional · Admin" }] }),
  component: AuditoriaPage,
});

function Stat({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warn ? "border-hot bg-hot/5" : "border-border bg-card"}`}>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
    </div>
  );
}

function AuditoriaPage() {
  const catFn = useServerFn(getCatalogAudit);
  const blFn = useServerFn(getBlingAudit);
  const aiFn = useServerFn(getAiAudit);
  const cat = useQuery({ queryKey: ["audit-catalog"], queryFn: () => catFn() });
  const bl = useQuery({ queryKey: ["audit-bling"], queryFn: () => blFn() });
  const ai = useQuery({ queryKey: ["audit-ai"], queryFn: () => aiFn() });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold uppercase">Auditoria Operacional</h1>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold uppercase">Catálogo</h2>
        {cat.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
            <Stat label="Total" value={cat.data?.total ?? 0} />
            <Stat label="Ativos" value={cat.data?.ativos ?? 0} />
            <Stat label="Inativos" value={cat.data?.inativos ?? 0} warn={(cat.data?.inativos ?? 0) > 0} />
            <Stat label="Com Bling ID" value={cat.data?.comBling ?? 0} />
            <Stat label="Sem Bling ID" value={cat.data?.semBling ?? 0} warn={(cat.data?.semBling ?? 0) > 0} />
            <Stat label="Sem imagem" value={cat.data?.semImagem ?? 0} warn={(cat.data?.semImagem ?? 0) > 0} />
            <Stat label="Sem categoria" value={cat.data?.semCategoria ?? 0} warn={(cat.data?.semCategoria ?? 0) > 0} />
            <Stat label="Sem marca" value={cat.data?.semMarca ?? 0} warn={(cat.data?.semMarca ?? 0) > 0} />
            <Stat label="Sem SKU" value={cat.data?.semSku ?? 0} warn={(cat.data?.semSku ?? 0) > 0} />
            <Stat label="Sem preço" value={cat.data?.semPreco ?? 0} warn={(cat.data?.semPreco ?? 0) > 0} />
            <Stat label="Sem estoque" value={cat.data?.semEstoque ?? 0} warn={(cat.data?.semEstoque ?? 0) > 0} />
            <Stat label="Sem aplicação" value={cat.data?.semAplicacao ?? 0} />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold uppercase">Bling</h2>
        {bl.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="Conectado" value={bl.data?.connected ? "Sim" : "Não"} warn={!bl.data?.connected} />
              <Stat label="Última sync" value={bl.data?.last_sync_at ? new Date(bl.data.last_sync_at).toLocaleString("pt-BR") : "—"} />
              <Stat label="Produtos importados" value={bl.data?.importados ?? 0} />
              <Stat label="Sucessos 24h" value={bl.data?.sucesso_24h ?? 0} />
              <Stat label="Erros totais" value={bl.data?.erros_total ?? 0} warn={(bl.data?.erros_total ?? 0) > 0} />
            </div>
            {(bl.data?.ultimos_erros?.length ?? 0) > 0 && (
              <div className="mt-3 rounded-lg border border-border bg-card p-3">
                <div className="mb-2 text-xs font-bold uppercase">Últimos erros</div>
                <ul className="space-y-1 text-xs">
                  {bl.data!.ultimos_erros.map((e: any, i: number) => (
                    <li key={i} className="border-b border-border pb-1 last:border-0">
                      <span className="font-mono text-muted-foreground">{new Date(e.created_at).toLocaleString("pt-BR")}</span>
                      {" · "}
                      <span className="font-bold">{e.entity}/{e.action}</span>
                      {" · "}
                      <span className="text-destructive">{e.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-bold uppercase">IA A&S Business</h2>
        {ai.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              <Stat label="Buscas registradas" value={ai.data?.total_buscas ?? 0} />
              <Stat label="Buscas sem resultado" value={ai.data?.buscas_sem_resultado ?? 0} warn={(ai.data?.buscas_sem_resultado ?? 0) > 0} />
              <Stat label="Ferramentas usadas" value={ai.data?.tools?.length ?? 0} />
            </div>
            {(ai.data?.tools?.length ?? 0) > 0 && (
              <div className="mt-3 rounded-lg border border-border bg-card p-3">
                <div className="mb-2 text-xs font-bold uppercase">Ferramentas MCP mais usadas</div>
                <ul className="space-y-1 text-sm">
                  {ai.data!.tools.map((t) => (
                    <li key={t.tool} className="flex justify-between">
                      <span className="font-mono">{t.tool}</span>
                      <span className="font-bold">{t.uses}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
