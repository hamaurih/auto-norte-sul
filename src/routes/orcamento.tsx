import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { FileText, Printer, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/lib/cart-store";
import { useSession } from "@/lib/session";
import { brl } from "@/lib/format";
import { createMyQuoteFromCart } from "@/lib/my-quotes.functions";

export const Route = createFileRoute("/orcamento")({
  head: () => ({ meta: [{ title: "Orçamento de peças · Norte Sul" }] }),
  component: QuotePreviewPage,
});

function QuotePreviewPage() {
  const { items, subtotal } = useCart();
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const createQuote = useServerFn(createMyQuoteFromCart);
  const [creating, setCreating] = useState(false);
  const attempt = useRef<{ key: string; fingerprint: string } | null>(null);

  async function saveAndContinue() {
    if (!items.length || creating) return;
    if (!user) {
      navigate({ to: "/auth", search: { next: "/orcamento" } as never });
      return;
    }
    const selections = items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    }));
    const fingerprint = JSON.stringify(selections);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { key: crypto.randomUUID(), fingerprint };
    }
    setCreating(true);
    try {
      const quote = await createQuote({
        data: { items: selections, requestKey: attempt.current.key },
      });
      attempt.current = null;
      toast.success("Orçamento #" + quote.number + " criado, sem aprovação da loja.");
      navigate({ to: "/orcamentos" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o orçamento.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="container-x py-8">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Norte Sul Autopeças</p>
        <h1 className="mt-1 font-display text-3xl font-bold uppercase">Seu orçamento</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Qualquer pessoa pode consultar uma prévia. Para salvar o orçamento numerado e transformá-lo
          em compra, basta entrar ou criar uma conta. Não há aprovação manual.
        </p>

        {!items.length ? (
          <div className="mt-8 rounded-xl border border-dashed p-8 text-center">
            <FileText className="mx-auto h-9 w-9 text-muted-foreground" />
            <p className="mt-3 font-semibold">Escolha as peças para montar seu orçamento.</p>
            <Link to="/catalogo" className="mt-4 inline-block rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">
              Ver peças
            </Link>
          </div>
        ) : (
          <>
            <section className="mt-6 overflow-hidden rounded-2xl border bg-card">
              {items.map((item) => (
                <div key={item.productId} className="flex items-center gap-4 border-b p-4 last:border-b-0">
                  {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="h-16 w-16 rounded-md object-contain" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-muted-foreground">SKU {item.sku} · {item.quantity} unidade(s)</p>
                  </div>
                  <strong className="shrink-0">{brl(item.unitPrice * item.quantity)}</strong>
                </div>
              ))}
            </section>
            <div className="mt-4 flex items-center justify-between rounded-xl border bg-muted/30 p-4">
              <span className="font-semibold">Subtotal estimado</span>
              <strong className="price-tag text-2xl">{brl(subtotal)}</strong>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Os valores exibidos nesta prévia vêm do carrinho. Preços comerciais, disponibilidade
              e condições de pagamento são recalculados no servidor ao salvar o orçamento.
              Frete ou retirada são definidos no checkout.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 print:hidden">
              <button type="button" onClick={saveAndContinue} disabled={creating || loading}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
                <FileText className="h-4 w-4" />
                {creating ? "Gerando orçamento…" : user ? "Salvar orçamento e comprar depois" : "Entrar e salvar orçamento"}
              </button>
              <Link to="/checkout" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-5 py-3 text-sm font-bold">
                <ShoppingCart className="h-4 w-4" /> Comprar direto
              </Link>
              <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold">
                <Printer className="h-4 w-4" /> Imprimir prévia
              </button>
            </div>
            {user && <Link to="/orcamentos" className="mt-4 inline-block text-sm font-semibold text-primary print:hidden">Ver meus orçamentos salvos</Link>}
          </>
        )}
      </div>
    </main>
  );
}
