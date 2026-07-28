import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/admin/ComingSoon";
export const Route = createFileRoute("/_authenticated/admin/promocoes")({
  head: () => ({ meta: [{ title: "Promoções · Admin" }] }),
  component: () => (
    <ComingSoon title="Promoções" phase="Fase 3">
      Tabela criada. Interface CRUD (por produto/categoria/marca/grupo comercial) chega na Fase 3.
    </ComingSoon>
  ),
});
