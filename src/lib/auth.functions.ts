import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const firstAccessPasswordSchema = z.object({
  password: z.string().min(8, "A nova senha deve ter no mínimo 8 caracteres.").max(72),
});

export const completeFirstAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => firstAccessPasswordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: current, error: currentError } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    if (currentError || !current.user) {
      throw new Error(currentError?.message ?? "Usuário não encontrado.");
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.password,
      app_metadata: {
        ...(current.user.app_metadata ?? {}),
        must_change_password: false,
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
