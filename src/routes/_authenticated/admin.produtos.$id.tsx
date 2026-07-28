import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ProductForm } from "@/components/admin/ProductForm";

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
      <div className="mb-4 flex items-center gap-2">
        <Link to="/admin/produtos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <h1 className="ml-2 font-display text-2xl font-bold uppercase">Editar Produto</h1>
      </div>
      {isLoading || !data ? (
        <div className="p-8 text-center text-muted-foreground">Carregando…</div>
      ) : (
        <ProductForm initial={data as any} />
      )}
    </div>
  );
}
