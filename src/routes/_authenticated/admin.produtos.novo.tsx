import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ProductForm } from "@/components/admin/ProductForm";

export const Route = createFileRoute("/_authenticated/admin/produtos/novo")({
  head: () => ({ meta: [{ title: "Novo produto · Admin" }] }),
  component: NewProduct,
});

function NewProduct() {
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/admin/produtos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <h1 className="ml-2 font-display text-2xl font-bold uppercase">Novo Produto</h1>
      </div>
      <ProductForm />
    </div>
  );
}
