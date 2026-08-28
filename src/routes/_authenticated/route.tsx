import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
    if (data.user.app_metadata?.must_change_password === true) {
      throw redirect({ to: "/primeiro-acesso" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
