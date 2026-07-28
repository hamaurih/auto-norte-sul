import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/bling")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/ecossistema/bling" });
  },
});
