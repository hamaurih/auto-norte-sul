import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { useSession } from "@/lib/session";

/**
 * Suprimentos é restrito a ADMIN e GERENTE (`isStaff`). O servidor já valida a
 * permissão em cada server function; este guard evita renderizar a tela e
 * disparar requisições para perfis sem acesso.
 */
export function SupplyGuard({ children }: { children: ReactNode }) {
  const { isStaff, loading } = useSession();

  if (loading) {
    return <p className="p-4 text-sm text-muted-foreground">Carregando permissões…</p>;
  }

  if (!isStaff) {
    return (
      <div role="alert" className="mx-auto max-w-2xl rounded-lg border border-destructive bg-destructive/5 p-6">
        <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
        <h1 className="mt-2 font-display text-xl font-bold uppercase">Acesso restrito</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O módulo de Suprimentos é exclusivo para perfis de administração e gerência.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
