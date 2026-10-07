import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pagamento")({
  validateSearch: z.object({ pedido: z.string().uuid() }),
  head: () => ({ meta: [{ title: "Pagamento · Norte Sul" }] }),
  component: Pagamento,
});

function Pagamento() {
  const { pedido } = Route.useSearch();
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ["boleto-pagamento", pedido],
    queryFn: async () => {
      const [orderResult, paymentResult] = await Promise.all([
        supabase.from("orders").select("id,total,status,payment_method,created_at").eq("id", pedido).maybeSingle(),
        supabase.from("payment_intents").select("id,status,boleto_url,boleto_barcode,expires_at,updated_at").eq("order_id", pedido).eq("method", "boleto").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (orderResult.error) throw orderResult.error;
      if (!orderResult.data) throw new Error("Pedido não encontrado.");
      if (String(orderResult.data.payment_method) !== "boleto") throw new Error("Este pedido não foi criado para pagamento por boleto.");
      if (paymentResult.error) throw paymentResult.error;
      return { order: orderResult.data, payment: paymentResult.data };
    },
    refetchInterval: (query) => query.state.data?.payment?.boleto_url ? false : 2000,
    refetchIntervalInBackground: true,
  });

  const copyBarcode = async () => {
    const code = data?.payment?.boleto_barcode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Linha digitável copiada.");
    } catch {
      toast.error("Não foi possível copiar automaticamente. Selecione o código e copie.");
    }
  };

  const boletoReady = Boolean(data?.payment?.boleto_url);
  const expires = data?.payment?.expires_at
    ? new Date(data.payment.expires_at).toLocaleDateString("pt-BR")
    : null;

  return (
    <main className="container-x py-8">
      <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase text-primary">Pedido #{pedido.slice(0, 8)}</span>
        <h1 className="mt-4 font-display text-3xl font-bold uppercase">Pagamento por boleto</h1>
        {data?.order && <p className="mt-2 text-sm text-muted-foreground">Valor do pedido: <b className="text-foreground">{brl(Number(data.order.total))}</b></p>}

        {isLoading || !boletoReady ? (
          <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-5">
            <div className="flex items-center gap-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">Preparando seu boleto</h2>
                <p className="mt-1 text-sm text-muted-foreground">Aguarde nesta página. Assim que o banco liberar, os botões aparecerão automaticamente.</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Última verificação: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR") : "agora"}.</p>
          </div>
        ) : (
          <section className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-5">
            <h2 className="font-display text-xl font-bold uppercase">Boleto disponível</h2>
            <p className="mt-1 text-sm text-muted-foreground">{expires ? `Vencimento: ${expires}.` : "Utilize o boleto dentro do prazo informado."}</p>
            {data.payment?.boleto_barcode && (
              <div className="mt-5">
                <label className="text-xs font-bold uppercase text-muted-foreground">Linha digitável</label>
                <div className="mt-1 rounded-md border border-border bg-background p-3 font-mono text-xs break-all">{data.payment.boleto_barcode}</div>
                <button type="button" onClick={copyBarcode} className="mt-2 w-full rounded-md border border-primary px-4 py-3 text-sm font-bold text-primary hover:bg-primary/5">Copiar linha digitável</button>
              </div>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <a href={data.payment?.boleto_url ?? "#"} target="_blank" rel="noreferrer" className="rounded-md bg-primary px-4 py-3 text-center text-sm font-bold uppercase text-primary-foreground hover:brightness-110">Abrir ou baixar boleto</a>
              <a href={data.payment?.boleto_url ?? "#"} target="_blank" rel="noreferrer" className="rounded-md border border-border px-4 py-3 text-center text-sm font-bold uppercase hover:bg-muted">Imprimir boleto</a>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Para imprimir, abra o boleto e use a opção de impressão do navegador.</p>
          </section>
        )}

        {error && <p className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error.message}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/pedidos" className="rounded-md border border-border px-4 py-3 text-sm font-bold uppercase hover:bg-muted">Ver meus pedidos</Link>
          <Link to="/catalogo" className="rounded-md px-4 py-3 text-sm font-bold uppercase text-primary hover:bg-primary/5">Continuar comprando</Link>
        </div>
      </div>
    </main>
  );
}
