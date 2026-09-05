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
      <div className="mx-auto mb-4 flex max-w-[1500px] items-center gap-2 text-sm">
        <Link to="/admin/produtos" className="inline-flex items-center gap-1.5 font-semibold text-slate-500 transition hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" /> Produtos
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-semibold text-slate-700">Novo produto</span>
      </div>
      <ProductForm />
    </div>
  );
}
