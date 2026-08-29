/**
 * Legacy sales-rep invitation endpoint.
 *
 * Fase 0 security containment: the historical Supabase Auth e-mail invitation
 * flow is permanently disabled. User provisioning must go through the central
 * tenant user-management flow, which creates the account without sending an
 * invitation e-mail and binds it to the active tenant explicitly.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";

export const inviteSalesRep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      full_name: string;
      email: string;
      phone?: string;
      commission_pct?: number;
      max_discount_pct?: number;
      notes?: string;
    }) => input,
  )
  .handler(async () => {
    throw new Error(
      "Fluxo antigo de convite por e-mail desativado por segurança. Cadastre o usuário em Administração > Usuários.",
    );
  });
