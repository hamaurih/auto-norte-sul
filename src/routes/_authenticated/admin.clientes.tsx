import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/admin/ComingSoon";
export const Route = createFileRoute("/_authenticated/admin/clientes")({
  head: () => ({ meta: [{ title: "Clientes · Admin" }] }),
  component: () => <ComingSoon title="Clientes" phase="Fase 2">Listagem, edição de grupo comercial e histórico de compras.</ComingSoon>,
});
