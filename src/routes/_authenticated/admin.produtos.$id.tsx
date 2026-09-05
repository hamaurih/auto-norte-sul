import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ProductForm } from "@/components/admin/ProductForm";
import "@/components/admin/product-form.css";

export const Route = createFileRoute("/_authenticated/admin/produtos/$id")({
  head: () => ({ meta: [{ title: "Editar produto · Admin" }] }),
  component: EditProduct,
});

function EditProduct() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-product", id],
    queryFn: async () => {
      const [{ data: p }, { data: imgs }] = await Promise.all([
        supabase.from("products").select("*").eq("id", id).single(),
        supabase.from("product_images").select("url, alt, is_primary, sort_order").eq("product_id", id).order("sort_order"),
      ]);
      if (!p) throw notFound();
      return { ...p, images: imgs ?? [] };
    },
  });

  return (
    <div>
      <div className="mx-auto mb-4 flex max-w-[1500px] items-center gap-2 text-sm">
        <Link to="/admin/produtos" className="inline-flex items-center gap-1.5 font-semibold text-slate-500 transition hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" /> Produtos
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-semibold text-slate-700">Editar produto</span>
      </div>
      {isLoading || !data ? (
        <div className="mx-auto max-w-[1500px] rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">Carregando produto…</div>
      ) : (
        <ProductForm initial={data as any} />
      )}
    </div>
  );
}
