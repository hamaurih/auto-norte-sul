import { createServerFn } from "@tanstack/react-start";
import { assertStaff } from "@/lib/auth-guards";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


export type BannerInput = {
  id?: string | null;
  title: string;
  subtitle?: string | null;
  image_url: string;
  image_mobile_url?: string | null;
  link_url?: string | null;
  cta_label?: string | null;
  position: string;
  sort_order: number;
  active: boolean;
  audience: "all" | "b2c" | "b2b";
  starts_at?: string | null;
  ends_at?: string | null;
};

export const bannerUpsert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: BannerInput) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { id, ...row } = data;
    const payload = { ...row, updated_at: new Date().toISOString() };
    if (id) {
      const { error } = await context.supabase.from("banners").update(payload).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: inserted, error } = await context.supabase.from("banners").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id };
  });

export const bannerDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { error } = await context.supabase.from("banners").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const bannerToggle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; active: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { error } = await context.supabase.from("banners").update({ active: data.active }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
