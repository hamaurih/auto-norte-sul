import { tdb } from "@/integrations/supabase/tenant-db";
import { runShippingEnrichmentAutopilot, type ShippingEnrichmentAutopilotResult } from "./shipping-enrichment-autopilot.server";
import { tryBlingShippingMeasurement } from "./shipping-bling-fallback.server";
import { tryOfficialMultiKeyMeasurement } from "./shipping-official-multikey-fallback.server";
import { tryOfficialNameCodeMeasurement } from "./shipping-official-measurement-fallback.server";
import { tryGs1ShippingMeasurement } from "./shipping-gs1-fallback.server";

async function markExhaustedIfSafe(admin: any, tenantId: string, jobId: string, currentReason?: string) {
  const { data: job, error } = await admin
    .from("product_enrichment_jobs")
    .select("id,status,last_error")
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job || job.status !== "queued") return null;

  const lastError = String(job.last_error ?? currentReason ?? "");
  const blingWasCheckedAndEmpty = lastError.includes("Bling: cadastro original consultado, sem peso/medidas detectáveis");
  if (!blingWasCheckedAndEmpty) return null;

  const finalReason = `${lastError} | Fontes automáticas atuais esgotadas; reprocessar quando houver nova fonte estruturada (GS1/TecDoc).`.slice(0, 1200);
  const { error: updateError } = await admin
    .from("product_enrichment_jobs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      last_error: finalReason,
    })
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .eq("status", "queued");
  if (updateError) return null;

  return {
    jobId,
    status: "failed",
    reason: finalReason,
  };
}

export async function runShippingEnrichmentAutopilotV2(): Promise<ShippingEnrichmentAutopilotResult> {
  const result = await runShippingEnrichmentAutopilot();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = tdb(supabaseAdmin) as any;

  for (const tenant of result.tenants) {
    for (let index = 0; index < tenant.details.length; index++) {
      const current = tenant.details[index];
      if (!["requeued", "failed", "skipped"].includes(current.status)) continue;

      const bling = await tryBlingShippingMeasurement(admin, tenant.tenantId, current);
      const multiKey = bling ? null : await tryOfficialMultiKeyMeasurement(admin, tenant.tenantId, current);
      const nameCode = bling || multiKey ? null : await tryOfficialNameCodeMeasurement(admin, tenant.tenantId, current);
      const gs1 = bling || multiKey || nameCode ? null : await tryGs1ShippingMeasurement(admin, tenant.tenantId, current);
      const improved = bling ?? multiKey ?? nameCode ?? gs1;

      if (improved) {
        if (current.status === "requeued") tenant.requeued = Math.max(0, tenant.requeued - 1);
        if (current.status === "failed" || current.status === "skipped") tenant.failed = Math.max(0, tenant.failed - 1);
        tenant.review += 1;
        tenant.details[index] = improved;
        continue;
      }

      if (current.status === "requeued") {
        const exhausted = await markExhaustedIfSafe(admin, tenant.tenantId, current.jobId, current.reason);
        if (exhausted) {
          tenant.requeued = Math.max(0, tenant.requeued - 1);
          tenant.failed += 1;
          tenant.details[index] = exhausted;
        }
      }
    }
  }

  return result;
}
