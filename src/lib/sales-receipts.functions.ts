import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { requireTenantRole } from "@/lib/auth-guards";

const READ_ROLES = ["owner","admin","manager","sales","stock","cashier"] as const;
const DECISION_ROLES = ["owner","admin","manager","sales"] as const;

export const getOrderReceipt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await requireTenantRole(sb, context.userId, context.tenantId, [...READ_ROLES]);

    const { data: receipt, error } = await sb.from("sales_receipts")
      .select("id,order_id,receipt_number,receipt_code,source_channel_id,source_pos_sale_id,operator_user_id,customer_id,issued_at,customer_snapshot,sale_snapshot,items_snapshot,payments_snapshot,snapshot_hash,created_at")
      .eq("tenant_id", context.tenantId)
      .eq("order_id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!receipt) return { receipt:null, decisions:[], documents:[], latestDecision:null };

    const [decisions, documents, command] = await Promise.all([
      sb.from("receipt_fiscal_decisions")
        .select("id,decision,reason,actor_user_id,created_at")
        .eq("tenant_id", context.tenantId)
        .eq("receipt_id", receipt.id)
        .order("created_at", { ascending:false })
        .limit(20),
      sb.from("fiscal_documents")
        .select("id,receipt_id,model,series,number,status,provider,provider_reference,access_key,protocol,document_url,xml_url,authorized_at,cancelled_at,created_at")
        .eq("tenant_id", context.tenantId)
        .eq("receipt_id", receipt.id)
        .order("created_at", { ascending:false }),
      sb.from("fiscal_emission_commands")
        .select("id,status,remote_invoice_id,last_error,started_at,submitted_at,finished_at,updated_at")
        .eq("tenant_id",context.tenantId)
        .eq("receipt_id",receipt.id)
        .maybeSingle(),
    ]);
    if (decisions.error) throw new Error(decisions.error.message);
    if (documents.error) throw new Error(documents.error.message);
    if (command.error) throw new Error(command.error.message);

    return {
      receipt,
      decisions: decisions.data ?? [],
      documents: documents.data ?? [],
      emissionCommand: command.data ?? null,
      latestDecision: decisions.data?.[0] ?? null,
    };
  });

export const setReceiptFiscalDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({
    receiptId: z.string().uuid(),
    decision: z.enum(["defer","request_invoice"]),
    reason: z.string().trim().max(500).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await requireTenantRole(sb, context.userId, context.tenantId, [...DECISION_ROLES]);
    const { data: id, error } = await sb.rpc("set_receipt_fiscal_decision", {
      p_receipt_id: data.receiptId,
      p_decision: data.decision,
      p_reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok:true, decisionId:id };
  });
