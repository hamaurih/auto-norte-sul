import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, AlertTriangle } from "lucide-react";
import { applyCodeReview, listCodeReviews } from "@/lib/code-review.functions";
import { normalizeCode, normalizeName } from "@/lib/product-codes";

export const Route = createFileRoute("/_authenticated/admin/revisao-codigos")({
  head: () => ({
    meta: [
      { title: "Revisão de códigos · Admin Norte Sul" },
      { name: "description", content: "Revisão manual de códigos internos e de fabricante dos produtos." },
      { property: "og:title", content: "Revisão de códigos · Admin Norte Sul" },
      { property: "og:description", content: "Corrija códigos internos, de fabricante e nomes pendentes de revisão." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CodeReviewPage,
});

type Draft = { name: string; internal_code: string; manufacturer_code: string };

function CodeReviewPage() {
  const qc = useQueryClient();
  const list = useServerFn(listCodeReviews);
  const apply = useServerFn(applyCodeReview);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["code-reviews"],
    queryFn: () => list({ data: { status: "review_required", limit: 100 } }),
  });

  useEffect(() => {
    if (!data?.rows) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of data.rows) {
        if (next[r.id]) continue;
        next[r.id] = {
          name: r.current?.name ?? r.proposed.name ?? r.original.name ?? "",
          internal_code: r.current?.internal_code ?? r.proposed.internal_code ?? "",
          manufacturer_code: r.current?.manufacturer_code ?? r.proposed.manufacturer_code ?? "",
        };
      }
      return next;
    });
  }, [data]);

  async function save(auditId: string, productId: string | null) {
    const draft = drafts[auditId];
    if (!productId) { toast.error("Registro sem produto vinculado"); return; }
    if (!draft || !normalizeName(draft.name)) { toast.error("Nome não pode ficar vazio"); return; }
    setSavingId(auditId);
    try {
      const res = await apply({
        data: {
          auditId,
          productId,
          name: normalizeName(draft.name),
          internal_code: normalizeCode(draft.internal_code),
          manufacturer_code: normalizeCode(draft.manufacturer_code),
        },
      });
      if (res.duplicateOf.length > 0) {
        toast.warning(`Código interno também usado em: ${res.duplicateOf.join(", ")}`);
      }
      toast.success("Revisão aplicada");
      qc.invalidateQueries({ queryKey: ["code-reviews"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao aplicar revisão");
    } finally {
      setSavingId(null);
    }
  }

  const inp = "w-full rounded border border-border bg-background px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold uppercase">Revisão de códigos</h1>
        <p className="text-sm text-muted-foreground">
          Casos em que o saneamento automático não teve confiança suficiente. Corrija código interno, código do
          fabricante e nome; o SKU/Bling é preservado.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando pendências…
        </div>
      )}
      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Falha ao carregar pendências"}
        </div>
      )}
      {!isLoading && !error && (data?.rows.length ?? 0) === 0 && (
        <div className="rounded border border-border p-6 text-sm text-muted-foreground">
          Nenhuma pendência de revisão de códigos.
        </div>
      )}

      <div className="space-y-3">
        {(data?.rows ?? []).map((r) => {
          const draft = drafts[r.id] ?? { name: "", internal_code: "", manufacturer_code: "" };
          return (
            <div key={r.id} className="rounded border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded bg-hot/15 px-1.5 py-0.5 font-bold uppercase text-hot">
                  <AlertTriangle className="h-3 w-3" /> revisão
                </span>
                {r.reason && <span>{r.reason}</span>}
                <span className="font-mono">SKU/Bling: {r.current?.sku ?? r.original.sku ?? "—"}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded bg-muted/40 p-2 text-xs">
                  <div className="mb-1 font-bold uppercase text-muted-foreground">Original</div>
                  <div>Nome: {r.original.name ?? "—"}</div>
                  <div className="font-mono">Interno: {r.original.internal_code ?? "—"}</div>
                  <div className="font-mono">Fabricante: {r.original.manufacturer_code ?? "—"}</div>
                  <div className="mt-1 font-bold uppercase text-muted-foreground">Proposta</div>
                  <div>Nome: {r.proposed.name ?? "—"}</div>
                  <div className="font-mono">Interno: {r.proposed.internal_code ?? "—"}</div>
                  <div className="font-mono">Fabricante: {r.proposed.manufacturer_code ?? "—"}</div>
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-bold uppercase text-muted-foreground">
                    Nome
                    <input
                      className={inp}
                      value={draft.name}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: { ...draft, name: e.target.value } }))}
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs font-bold uppercase text-muted-foreground">
                      Código interno
                      <input
                        className={`${inp} font-mono`}
                        value={draft.internal_code}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [r.id]: { ...draft, internal_code: e.target.value.toUpperCase() } }))
                        }
                      />
                    </label>
                    <label className="text-xs font-bold uppercase text-muted-foreground">
                      Código do fabricante
                      <input
                        className={`${inp} font-mono`}
                        value={draft.manufacturer_code}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [r.id]: { ...draft, manufacturer_code: e.target.value.toUpperCase() },
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => save(r.id, r.product_id)}
                    disabled={savingId === r.id}
                    className="inline-flex items-center justify-center gap-1 rounded bg-primary px-3 py-2 text-xs font-bold uppercase text-primary-foreground disabled:opacity-50"
                  >
                    {savingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Salvar e marcar como aplicado
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
