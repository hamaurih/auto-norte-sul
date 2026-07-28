import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/admin/ComingSoon";
export const Route = createFileRoute("/_authenticated/admin/cupons")({
  head: () => ({ meta: [{ title: "Cupons · Admin" }] }),
  component: () => (
    <ComingSoon title="Cupons de Desconto" phase="Fase 3">
      Tabelas <code>coupons</code> e <code>coupon_usages</code> criadas. Interface e integração no carrinho chegam na Fase 3.
    </ComingSoon>
  ),
});
