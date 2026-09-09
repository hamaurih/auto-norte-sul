import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BadgeDollarSign, CheckCircle2, FileSearch, RefreshCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { BlingCostRecoveryPanel } from "@/components/admin/BlingCostRecoveryPanel";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveProductCostCandidates, approveValidatedBlingCostBatch, listCostSanitationCandidates, proposeManualProductCost, refreshCostSanitationQueue } from "@/lib/inventory-financial.functions";
import { brl } from "@/lib/format";
import { num, qty } from "@/lib/supplies-ui";

export const Route = createFileRoute("/_authenticated/admin/saneamento-custos")({
  head: () => ({ meta: [{ title: "Saneamento de custos · Admin" }, { name: "description", content: "Fila auditável para recuperar e aprovar custos reais." }] }),
  component: () => <SupplyGuard><CostSanitationPage /></SupplyGuard>,
});

const statusLabel: Record<string,string> = { awaiting_source: "Sem fonte", pending: "Aguardando aprovação", approved: "Aprovados" };
const sourceLabel: Record<string,string> = { missing: "Sem evidência", nfe_xml: "XML NF-e", goods_receipt: "Recebimento", purchase_order: "Pedido de compra", bling: "Bling", spreadsheet: "Planilha", manual: "Informado manualmente" };

function blingQuality(row:any) {
  if (row.source_type !== "bling") return { eligible: true, reason: "Fonte controlada" };
  const gate = row.evidence?.quality_gate;
  return {
    eligible: gate?.eligible === true,
    reason: String(gate?.reason ?? "Custo do Bling ainda não validado pela barreira de qualidade"),
  };
}

function CostSanitationPage() {
  const qc = useQueryClient();
  const [status,setStatus] = useState("awaiting_source");
  const [search,setSearch] = useState("");
  const [selected,setSelected] = useState<string[]>([]);
  const listFn = useServerFn(listCostSanitationCandidates);
  const refreshFn = useServerFn(refreshCostSanitationQueue);
  const proposeFn = useServerFn(proposeManualProductCost);
  const approveFn = useServerFn(approveProductCostCandidates);
  const approveValidatedFn = useServerFn(approveValidatedBlingCostBatch);
  const query = useQuery({ queryKey:["cost-sanitation",status,search], queryFn:()=>listFn({data:{status,search}}) });
  const rows = (query.data ?? []) as any[];
  const selectedSet = useMemo(()=>new Set(selected),[selected]);
  const invalidate = () => {
    qc.invalidateQueries({queryKey:["cost-sanitation"]});
    qc.invalidateQueries({queryKey:["inventory-financial-position"]});
    qc.invalidateQueries({queryKey:["product-cost-history"]});
    qc.invalidateQueries({queryKey:["bling-cost-recovery-status"]});
  };

  const refresh = useMutation({ mutationFn:()=>refreshFn(), onSuccess:(r)=>{toast.success(`${r.processed ?? 0} produtos reavaliados`);invalidate();}, onError:(e:Error)=>toast.error(e.message) });
  const approve = useMutation({ mutationFn:()=>approveFn({data:{ids:selected}}), onSuccess:(r)=>{toast.success(`${r.approved ?? 0} custos aprovados`);setSelected([]);invalidate();}, onError:(e:Error)=>toast.error(e.message) });
  const approveValidated = useMutation({
    mutationFn: async () => {
      let total = 0;
      let remaining = 1;
      for (let batch = 0; batch < 20 && remaining > 0; batch += 1) {
        const result = await approveValidatedFn({data:{limit:500}});
        const approved = Number(result.approved ?? 0);
        remaining = Number(result.remaining ?? 0);
        total += approved;
        if (approved <= 0) break;
      }
      return { total, remaining };
    },
    onSuccess:(r)=>{
      if (r.total > 0) toast.success(`${r.total} custos do Bling validados e aprovados`);
      else toast.info("Não há custos do Bling aptos para aprovação automática");
      if (r.remaining > 0) toast.warning(`${r.remaining} custos aptos ainda aguardam aprovação`);
      setSelected([]);
      invalidate();
    },
    onError:(e:Error)=>toast.error(e.message),
  });
  const propose = useMutation({ mutationFn:(data:{productId:string;cost:number;evidence:string})=>proposeFn({data}), onSuccess:()=>{toast.success("Custo enviado para aprovação");invalidate();}, onError:(e:Error)=>toast.error(e.message) });

  const capture = (row:any) => {
    const raw = prompt(`Custo real de ${row.product?.name} (ex.: 25,90):`);
    if (!raw) return;
    const cost = Number(raw.replace(",","."));
    if (!Number.isFinite(cost) || cost<=0) return toast.error("Informe um custo válido");
    const evidence = prompt("Origem/evidência: número da NF-e, fornecedor, documento ou planilha:");
    if (!evidence?.trim()) return toast.error("A evidência é obrigatória");
    propose.mutate({productId:row.product_id,cost,evidence:evidence.trim()});
  };

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="rounded-3xl border bg-gradient-to-br from-amber-500/15 via-card to-primary/10 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div>
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-800"><ShieldCheck className="h-4 w-4"/> CUSTOS COM EVIDÊNCIA</div>
        <h1 className="mt-3 font-display text-3xl font-bold">Saneamento financeiro inicial</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Recupere custos de XML, recebimentos, compras, Bling ou documentos. Nenhum custo altera o produto nem o preço de venda sem validação e aprovação gerencial.</p>
      </div><Button variant="outline" asChild><Link to="/admin/historico-custos">Voltar ao financeiro</Link></Button></div>
    </header>

    <BlingCostRecoveryPanel />

    <section className="grid gap-3 md:grid-cols-3">
      <div className="rounded-2xl border bg-card p-4"><FileSearch className="h-5 w-5 text-amber-700"/><div className="mt-2 text-2xl font-bold">{qty(rows.length)}</div><p className="text-xs text-muted-foreground">{statusLabel[status]} exibidos</p></div>
      <div className="rounded-2xl border bg-card p-4"><BadgeDollarSign className="h-5 w-5 text-primary"/><div className="mt-2 text-2xl font-bold">{qty(selected.length)}</div><p className="text-xs text-muted-foreground">Selecionados para aprovação</p></div>
      <div className="rounded-2xl border bg-card p-4"><CheckCircle2 className="h-5 w-5 text-emerald-700"/><div className="mt-2 text-sm font-bold">Tripla barreira</div><p className="text-xs text-muted-foreground">Fonte + plausibilidade + aprovação gerencial</p></div>
    </section>

    <div className="flex flex-wrap gap-2">
      {Object.entries(statusLabel).map(([key,label])=><Button key={key} size="sm" variant={status===key?"default":"outline"} onClick={()=>{setStatus(key);setSelected([])}}>{label}</Button>)}
      <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={()=>refresh.mutate()}><RefreshCcw className="mr-2 h-4 w-4"/>{refresh.isPending?"Analisando…":"Buscar fontes novamente"}</Button>
      {status==="pending" && <Button size="sm" disabled={!selected.length||approve.isPending||approveValidated.isPending} onClick={()=>approve.mutate()}>Aprovar selecionados ({selected.length})</Button>}
      {status==="pending" && <Button size="sm" variant="secondary" disabled={approveValidated.isPending||approve.isPending} onClick={()=>approveValidated.mutate()}><ShieldCheck className="mr-2 h-4 w-4"/>{approveValidated.isPending?"Aprovando lotes…":"Aprovar Bling validado em lote"}</Button>}
    </div>
    <Input className="max-w-md" placeholder="Buscar produto, SKU ou código" value={search} onChange={(e)=>setSearch(e.target.value)}/>

    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[1050px] text-sm"><thead className="bg-muted/50 text-xs uppercase text-muted-foreground"><tr>
        {status==="pending"&&<th className="p-3 text-left">Selecionar</th>}<th className="p-3 text-left">Produto</th><th className="p-3 text-left">Fonte</th><th className="p-3 text-left">Qualidade</th><th className="p-3 text-right">Custo proposto</th><th className="p-3 text-right">Preço atual</th><th className="p-3 text-right">Margem bruta</th><th className="p-3 text-right">Ação</th>
      </tr></thead><tbody>{rows.map(row=>{
        const quality = blingQuality(row);
        return <tr key={row.id} className="border-t">
          {status==="pending"&&<td className="p-3"><input aria-label="Selecionar custo" type="checkbox" disabled={!quality.eligible} checked={selectedSet.has(row.id)} onChange={(e)=>setSelected(e.target.checked?[...selected,row.id]:selected.filter(id=>id!==row.id))}/></td>}
          <td className="p-3"><div className="font-semibold">{row.product?.name}</div><div className="text-xs text-muted-foreground">{[row.product?.internal_code,row.product?.manufacturer_code,row.product?.sku].filter(Boolean).join(" · ")} · estoque {qty(row.product?.stock)}</div></td>
          <td className="p-3"><div>{sourceLabel[row.source_type]??row.source_type}</div><div className="text-xs text-muted-foreground">{row.source_reference??"Evidência ainda não informada"}</div></td>
          <td className="p-3">{quality.eligible?<div className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4"/>Apto</div>:<div><div className="inline-flex items-center gap-1 text-xs font-bold text-amber-700"><TriangleAlert className="h-4 w-4"/>Revisar</div><div className="mt-1 max-w-xs text-xs text-muted-foreground">{quality.reason}</div></div>}</td>
          <td className="p-3 text-right font-bold">{row.proposed_cost?brl(num(row.proposed_cost)):"—"}</td>
          <td className="p-3 text-right">{brl(num(row.current_price))}</td>
          <td className="p-3 text-right">{row.projected_margin_rate==null?"—":`${(num(row.projected_margin_rate)*100).toFixed(1)}%`}</td>
          <td className="p-3 text-right">{row.status==="awaiting_source"||!quality.eligible?<Button size="sm" variant="outline" onClick={()=>capture(row)}>Informar custo</Button>:"—"}</td>
        </tr>;
      })}</tbody></table>
      {!query.isLoading&&!rows.length&&<p className="p-8 text-center text-sm text-muted-foreground">Nenhum produto nesta etapa.</p>}
    </div>
    <p className="text-xs text-muted-foreground">Para o Bling, o lote automático exige concordância entre preço de custo e preço de compra (tolerância de 5%) e bloqueia outliers grosseiros. Aprovar registra histórico e auditoria. O preço de venda nunca é alterado automaticamente.</p>
  </div>;
}