import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listAliases, upsertAlias, deleteAlias, toggleAlias, listNoResultLogs } from "@/lib/aliases.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { normalizeTerm } from "@/lib/normalize";

export const Route = createFileRoute("/_authenticated/admin/saneamento/aliases")({
  head: () => ({ meta: [{ title: "Aliases e Sinônimos · Saneamento · Admin" }] }),
  component: AliasesPage,
});

type TargetType = "product" | "category" | "brand" | "tag" | "generic";

function AliasesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold uppercase">Aliases e Sinônimos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Termos populares (ex: "dvd", "central", "som") que direcionam a busca para uma categoria, marca ou produto específico.
        </p>
      </div>
      <Tabs defaultValue="aliases">
        <TabsList>
          <TabsTrigger value="aliases">Aliases</TabsTrigger>
          <TabsTrigger value="sem-resultado">Buscas sem resultado</TabsTrigger>
        </TabsList>
        <TabsContent value="aliases" className="mt-4"><AliasesTab /></TabsContent>
        <TabsContent value="sem-resultado" className="mt-4"><NoResultsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function AliasesTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAliases);
  const upFn = useServerFn(upsertAlias);
  const delFn = useServerFn(deleteAlias);
  const togFn = useServerFn(toggleAlias);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("");

  const q = useQuery({
    queryKey: ["aliases", search, filterType],
    queryFn: () => listFn({ data: { search: search || undefined, targetType: filterType || undefined, limit: 500 } }),
  });

  const { data: brands } = useQuery({ queryKey: ["all-brands-al"], queryFn: async () => (await supabase.from("brands").select("id, name, slug").order("name")).data ?? [] });
  const { data: categories } = useQuery({ queryKey: ["all-cats-al"], queryFn: async () => (await supabase.from("categories").select("id, name, slug").order("name")).data ?? [] });

  // Form
  const [term, setTerm] = useState("");
  const [targetType, setTargetType] = useState<TargetType>("category");
  const [targetSlug, setTargetSlug] = useState("");
  const [weight, setWeight] = useState(10);

  const save = useMutation({
    mutationFn: () => {
      const targetLabel = targetType === "category"
        ? (categories ?? []).find((c) => c.slug === targetSlug)?.name ?? null
        : targetType === "brand"
        ? (brands ?? []).find((b) => b.slug === targetSlug)?.name ?? null
        : null;
      return upFn({ data: { term, target_type: targetType, target_slug: targetSlug || null, target_label: targetLabel, weight, is_active: true } });
    },
    onSuccess: () => { toast.success("Alias salvo"); setTerm(""); qc.invalidateQueries({ queryKey: ["aliases"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const rm = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Alias removido"); qc.invalidateQueries({ queryKey: ["aliases"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const tog = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => togFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["aliases"] }),
  });

  return (
    <div className="space-y-4">
      {/* Formulário */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 text-xs font-bold uppercase">Novo alias</div>
        <div className="grid gap-2 md:grid-cols-[1fr_140px_1fr_100px_auto]">
          <Input placeholder='Termo (ex: "dvd", "som")' value={term} onChange={(e) => setTerm(e.target.value)} />
          <select className="rounded border border-border bg-background px-2 text-sm" value={targetType} onChange={(e) => { setTargetType(e.target.value as TargetType); setTargetSlug(""); }}>
            <option value="category">Categoria</option>
            <option value="brand">Marca</option>
            <option value="product">Produto</option>
            <option value="tag">Tag</option>
            <option value="generic">Genérico</option>
          </select>
          {targetType === "category" ? (
            <select className="rounded border border-border bg-background px-2 text-sm" value={targetSlug} onChange={(e) => setTargetSlug(e.target.value)}>
              <option value="">Selecione a categoria...</option>
              {(categories ?? []).map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
            </select>
          ) : targetType === "brand" ? (
            <select className="rounded border border-border bg-background px-2 text-sm" value={targetSlug} onChange={(e) => setTargetSlug(e.target.value)}>
              <option value="">Selecione a marca...</option>
              {(brands ?? []).map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
            </select>
          ) : (
            <Input placeholder="Slug ou ID de destino" value={targetSlug} onChange={(e) => setTargetSlug(e.target.value)} />
          )}
          <Input type="number" value={weight} onChange={(e) => setWeight(Number(e.target.value))} title="Peso/prioridade" />
          <Button onClick={() => save.mutate()} disabled={!term || save.isPending}>Salvar</Button>
        </div>
        {term && (
          <p className="mt-2 text-xs text-muted-foreground">Normalizado: <code>{normalizeTerm(term)}</code></p>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar por termo ou destino..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select className="rounded border border-border bg-background px-2 py-1 text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="category">Categoria</option>
          <option value="brand">Marca</option>
          <option value="product">Produto</option>
          <option value="tag">Tag</option>
          <option value="generic">Genérico</option>
        </select>
        <span className="text-xs text-muted-foreground">{q.data?.length ?? 0} aliases</span>
      </div>

      {/* Lista */}
      <div className="rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted"><tr>
            <th className="p-2 text-left">Termo</th>
            <th className="p-2 text-left">Normalizado</th>
            <th className="p-2 text-left">Tipo</th>
            <th className="p-2 text-left">Destino</th>
            <th className="p-2 text-center">Peso</th>
            <th className="p-2 text-center">Ativo</th>
            <th className="p-2 text-right">Ações</th>
          </tr></thead>
          <tbody>
            {(q.data ?? []).map((a: any) => (
              <tr key={a.id} className="border-t border-border">
                <td className="p-2 font-bold">{a.term}</td>
                <td className="p-2 font-mono text-xs text-muted-foreground">{a.normalized_term}</td>
                <td className="p-2"><Badge variant="outline">{a.target_type}</Badge></td>
                <td className="p-2">{a.target_label ?? a.target_slug ?? "—"}</td>
                <td className="p-2 text-center">{a.weight}</td>
                <td className="p-2 text-center">
                  <input type="checkbox" checked={a.is_active} onChange={(e) => tog.mutate({ id: a.id, is_active: e.target.checked })} />
                </td>
                <td className="p-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remover alias "${a.term}"?`)) rm.mutate(a.id); }}>Remover</Button>
                </td>
              </tr>
            ))}
            {(q.data ?? []).length === 0 && <tr><td colSpan={7} className="p-4 text-center text-sm text-muted-foreground">Nenhum alias.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NoResultsTab() {
  const fn = useServerFn(listNoResultLogs);
  const q = useQuery({ queryKey: ["snrl"], queryFn: () => fn({ data: { limit: 500 } }) });
  return (
    <div className="rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted"><tr>
          <th className="p-2 text-left">Termo</th>
          <th className="p-2 text-left">Normalizado</th>
          <th className="p-2 text-center">Ocorrências</th>
          <th className="p-2 text-left">Origens</th>
          <th className="p-2 text-left">Última vez</th>
        </tr></thead>
        <tbody>
          {(q.data ?? []).map((r) => (
            <tr key={r.normalized_term} className="border-t border-border">
              <td className="p-2 font-bold">{r.term}</td>
              <td className="p-2 font-mono text-xs text-muted-foreground">{r.normalized_term}</td>
              <td className="p-2 text-center">{r.count}</td>
              <td className="p-2 text-xs">{r.origins.join(", ")}</td>
              <td className="p-2 text-xs text-muted-foreground">{new Date(r.last_seen).toLocaleString("pt-BR")}</td>
            </tr>
          ))}
          {(q.data ?? []).length === 0 && <tr><td colSpan={5} className="p-4 text-center text-sm text-muted-foreground">Nenhuma busca sem resultado registrada ainda.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
