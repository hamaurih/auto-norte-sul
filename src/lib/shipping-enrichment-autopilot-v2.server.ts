import { tdb } from "@/integrations/supabase/tenant-db";
import { runShippingEnrichmentAutopilot, type ShippingEnrichmentAutopilotResult } from "./shipping-enrichment-autopilot.server";
import { tryOfficialMultiKeyMeasurement } from "./shipping-official-multikey-fallback.server";
import { tryOfficialNameCodeMeasurement } from "./shipping-official-measurement-fallback.server";
import { tryGs1ShippingMeasurement } from "./shipping-gs1-fallback.server";

export async function runShippingEnrichmentAutopilotV2(): Promise<ShippingEnrichmentAutopilotResult> {
  const result = await runShippingEnrichmentAutopilot();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = tdb(supabaseAdmin) as any;

  for (const tenant of result.tenants) {
    for (let index = 0; index < tenant.details.length; index++) {
      const current = tenant.details[index];
      if (!["requeued", "failed", "skipped"].includes(current.status)) continue;

      const multiKey = await tryOfficialMultiKeyMeasurement(admin, tenant.tenantId, current);
      const nameCode = multiKey ? null : await tryOfficialNameCodeMeasurement(admin, tenant.tenantId, current);
      const gs1 = multiKey || nameCode ? null : await tryGs1ShippingMeasurement(admin, tenant.tenantId, current);
      const improved = multiKey ?? nameCode ?? gs1;
      if (!improved) continue;

      if (current.status === "requeued") tenant.requeued = Math.max(0, tenant.requeued - 1);
      if (current.status === "failed" || current.status === "skipped") tenant.failed = Math.max(0, tenant.failed - 1);
      tenant.review += 1;
      tenant.details[index] = improved;
    }
  }

  return result;
}
