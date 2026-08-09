import { useEffect, useState } from "react";
import {
  activeTenantSlug,
  setActiveTenantSlug,
} from "@/integrations/supabase/tenant";
import { environmentLabel, useAccessContext } from "@/lib/access";

const fallbackEnvironments = [
  { slug: "norte-sul-real", label: "Conta real" },
  { slug: "norte-sul-demo", label: "Conta de teste" },
];

export function TenantEnvironmentSwitcher() {
  const [value, setValue] = useState("norte-sul-real");
  const { data: context } = useAccessContext();

  useEffect(() => {
    setValue(activeTenantSlug());
  }, []);

  // Only environments the signed-in user is a member of can be selected.
  const authorized = (context?.tenants ?? [])
    .filter((tenant) => tenant.storefront_slug)
    .map((tenant) => ({
      slug: tenant.storefront_slug as string,
      label: environmentLabel[tenant.environment] ?? tenant.environment,
    }));
  const environments = authorized.length > 0 ? authorized : fallbackEnvironments;

  return (
    <div className="border-b border-border bg-card px-4 py-2">
      <label className="mx-auto flex max-w-7xl items-center justify-end gap-2 text-xs font-semibold">
        <span className="uppercase text-muted-foreground">Ambiente</span>
        <select
          value={value}
          onChange={(event) => {
            const slug = event.target.value;
            setValue(slug);
            // Switching only changes the active tenant; the session is preserved.
            setActiveTenantSlug(slug);
          }}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
        >
          {environments.map((environment) => (
            <option key={environment.slug} value={environment.slug}>
              {environment.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
