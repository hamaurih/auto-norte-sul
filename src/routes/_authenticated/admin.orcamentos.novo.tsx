import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuoteForm } from "@/components/admin/QuoteForm";
import { generateProposal } from "@/lib/quotes.functions";

export const Route = createFileRoute("/_authenticated/admin/orcamentos/novo")({
  head: () => ({
    meta: [
      { title: "Novo orçamento · Norte Sul" },
      { name: "description", content: "Criar orçamento comercial com cliente, itens e condições." },
    ],
  }),
  component: NovoOrcamentoPage,
});

function NovoOrcamentoPage() {
  const navigate = useNavigate();
  const proposalFn = useServerFn(generateProposal);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/orcamentos">
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Link>
          </Button>
          <h1 className="mt-2 font-display text-2xl font-bold">Novo orçamento</h1>
          <p className="text-sm text-muted-foreground">
            Salve como rascunho e transforme em proposta quando estiver pronto.
          </p>
        </div>
      </header>

      <QuoteForm
        status="rascunho"
        onSaved={(id) => navigate({ to: "/admin/orcamentos/$id", params: { id } })}
        onGenerateProposal={async (id) => {
          try {
            await proposalFn({ data: { id } });
            toast.success("Proposta gerada.");
          } catch (error) {
            toast.error((error as Error).message || "Não foi possível gerar a proposta.");
          }
          navigate({ to: "/admin/orcamentos/$id", params: { id } });
        }}
      />
    </div>
  );
}
