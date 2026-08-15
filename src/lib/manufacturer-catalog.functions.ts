import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupplyRole, SUPPLY_APPROVE_ROLES } from "./supplies.server";

const SOURCE_KINDS = ["official_site", "official_catalog", "catalog_api", "supplier_feed", "manual"] as const;

function httpsUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("URL inválida"); }
  if (parsed.protocol !== "https:") throw new Error("A fonte precisa usar HTTPS");
  return parsed;
}

export const listManufacturerCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const [{ data: sources, error: sourceError }, { data: brands, error: brandError }, { data: patterns, error: patternError }] = await Promise.all([
      sb.from("manufacturer_catalog_sources").select("id,brand_id,name,source_kind,base_url,search_url_template,allowed_domains,supported_fields,image_usage_note,priority,status,last_verified_at,last_sync_at,last_error,brand:brands(name)").eq("tenant_id", context.tenantId).order("priority", { ascending: false }),
      sb.from("brands").select("id,name").eq("tenant_id", context.tenantId).order("name"),
      sb.from("manufacturer_code_patterns").select("id,brand_id,name,code_regex,normalized_prefix,examples,priority,active").eq("tenant_id", context.tenantId).order("priority", { ascending: false }),
    ]);
    if (sourceError) throw new Error(sourceError.message);
    if (brandError) throw new Error(brandError.message);
    if (patternError) throw new Error(patternError.message);
    return { sources: sources ?? [], brands: brands ?? [], patterns: patterns ?? [] };
  });

export const saveManufacturerSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { brandId: string; name: string; sourceKind: typeof SOURCE_KINDS[number]; baseUrl: string; priority?: number }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    if (!SOURCE_KINDS.includes(data.sourceKind)) throw new Error("Tipo de fonte inválido");
    const parsed = httpsUrl(data.baseUrl);
    const { error } = await sb.from("manufacturer_catalog_sources").insert({
      tenant_id: context.tenantId, brand_id: data.brandId, name: data.name.trim(),
      source_kind: data.sourceKind, base_url: parsed.origin,
      allowed_domains: [parsed.hostname.toLowerCase()], priority: Math.max(1, Math.min(100, Number(data.priority ?? 50))),
      created_by: context.userId, last_verified_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setManufacturerSourceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sourceId: string; status: "active" | "paused" }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    const { error } = await sb.from("manufacturer_catalog_sources").update({ status: data.status })
      .eq("tenant_id", context.tenantId).eq("id", data.sourceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveManufacturerCodePattern = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { brandId: string; name: string; codeRegex: string; normalizedPrefix?: string; examples?: string[] }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    try { new RegExp(data.codeRegex); } catch { throw new Error("Expressão do código inválida"); }
    const { error } = await sb.from("manufacturer_code_patterns").insert({
      tenant_id: context.tenantId, brand_id: data.brandId, name: data.name.trim(),
      code_regex: data.codeRegex, normalized_prefix: data.normalizedPrefix?.trim() || null,
      examples: (data.examples ?? []).map(v => v.trim()).filter(Boolean).slice(0, 10), created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
