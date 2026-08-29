import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/ecossistema")({
  head: () => ({ meta: [{ title: "Ecossistema de Integrações · Admin" }] }),
  component: () => (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link to="/admin/ecossistema" className="font-display text-2xl font-bold uppercase">
          Ecossistema de Integrações
        </Link>
      </div>
      <Outlet />
    </div>
  ),
});
