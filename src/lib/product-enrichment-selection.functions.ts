import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { requireSupplyRole, SUPPLY_APPROVE_ROLES } from "./supplies.server";

export type EnrichmentSelectionKind = "image" | "application";

export const setProductEnrichmentItemSelection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    candidateId: string;
    kind: EnrichmentSelectionKind;
    itemIds?: string[];
    selected: boolean;
  }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);

    const itemIds = data.itemIds?.filter(Boolean);
    const { data: result, error } = await sb.rpc("set_product_enrichment_item_selection", {
      p_candidate_id: data.candidateId,
      p_kind: data.kind,
      p_item_ids: itemIds?.length ? itemIds : null,
      p_selected: Boolean(data.selected),
    });
    if (error) throw new Error(error.message);

    return result as {
      ok: boolean;
      candidate_id: string;
      kind: EnrichmentSelectionKind;
      changed: number;
      selected: number;
      total: number;
    };
  });
