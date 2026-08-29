import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";
import { MAX_NFE_XML_BYTES, NfeValidationError, parseNfeXml } from "./nfe-xml";
import { normalizeCode } from "./product-codes";
import {
  NFE_PRODUCT_SELECT,
  confidenceFor,
  deriveNfeStatus,
  effectiveUnitCost,
  itemDivergences,
  matchNfeItem,
  sha256Hex,
  type ItemDivergence,
  type MatchSource,
  type NfeStatus,
  type ProductCandidate,
} from "./nfe.server";
import {
  SUPPLY_APPROVE_ROLES,
  SUPPLY_READ_ROLES,
  SUPPLY_WRITE_ROLES,
  requireSupplyRole,
  round2,
} from "./supplies.server";

const IMPORT_SELECT =
  "id, access_key, file_name, file_hash, nfe_version, nfe_number, nfe_series, nfe_model, operation_nature, issued_at, entered_at, emitter_tax_id, emitter_name, emitter_trade_name, emitter_state_tax_id, emitter_address, recipient_tax_id, recipient_name, total_products, total_discount, total_freight, total_invoice, items_count, supplier_id, purchase_order_id, warehouse_id, goods_receipt_id, no_order_reason, status, cancel_reason, created_at, updated_at, confirmed_at, supplier:suppliers(id, legal_name, trade_name, tax_id), purchase_order:purchase_orders(id, number, status), warehouse:warehouses(id, name, code), goods_receipt:goods_receipts(id, number, status)";

const ITEM_SELECT =
  "id, line_number, supplier_code, gtin, description, ncm, cfop, unit, qty, unit_value, discount_amount, freight_amount, other_amount, total_amount, product_id, purchase_order_item_id, match_source, match_confidence, divergences, notes, product:products(id, name, sku, internal_code, manufacturer_code, gtin, last_purchase_cost, average_cost)";

// ===================== Importação =====================

export const importNfeXml = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { xml: string; fileName?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);

    const xml = String(data.xml ?? "");
    const size = new TextEncoder().encode(xml).length;
    if (size === 0) throw new Error("Arquivo XML vazio.");
    if (size > MAX_NFE_XML_BYTES) {
      throw new Error(`Arquivo acima do limite de ${Math.round(MAX_NFE_XML_BYTES / 1024 / 1024)} MB.`);
    }
    if (!/<\s*(\w+:)?(nfeProc|NFe)\b/.test(xml)) {
      throw new Error("O arquivo não parece ser um XML de NF-e (raiz nfeProc ou NFe não encontrada).");
    }

    let parsed;
    try {
      parsed = parseNfeXml(xml);
    } catch (error) {
      if (error instanceof NfeValidationError) {
        throw new Error(`XML de NF-e inválido: ${error.details.slice(0, 4).join(" ")}`);
      }
      throw error;
    }

    const fileHash = await sha256Hex(xml);

    // Idempotência: mesma chave ou mesmo arquivo nunca gera duas entradas.
    const { data: existing, error: existingError } = await sb
      .from("nfe_imports")
      .select("id, access_key, status")
      .eq("tenant_id", context.tenantId)
      .or(`access_key.eq.${parsed.access_key},file_hash.eq.${fileHash}`)
      .maybeSingle();
    if (existingError && existingError.code !== "PGRST116") throw new Error(existingError.message);
    if (existing) {
      return { ok: true, id: existing.id as string, duplicated: true, status: existing.status as NfeStatus };
    }

    // Fornecedor pelo CNPJ/CPF do emitente (sem cadastro silencioso).
    const { data: supplier, error: supplierError } = await sb
      .from("suppliers")
      .select("id")
      .eq("tenant_id", context.tenantId)
      .eq("tax_id", parsed.emitter_tax_id)
      .maybeSingle();
    if (supplierError && supplierError.code !== "PGRST116") throw new Error(supplierError.message);

    const supplierId = (supplier?.id ?? null) as string | null;

    const { data: warehouse } = await sb
      .from("warehouses")
      .select("id")
      .eq("tenant_id", context.tenantId)
      .eq("active", true)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: inserted, error: insertError } = await sb
      .from("nfe_imports")
      .insert({
        tenant_id: context.tenantId,
        access_key: parsed.access_key,
        file_hash: fileHash,
        file_name: data.fileName?.slice(0, 200) ?? null,
        file_size: size,
        nfe_version: parsed.nfe_version,
        nfe_number: parsed.nfe_number,
        nfe_series: parsed.nfe_series,
        nfe_model: parsed.nfe_model,
        operation_nature: parsed.operation_nature,
        issued_at: parsed.issued_at,
        entered_at: new Date().toISOString(),
        emitter_tax_id: parsed.emitter_tax_id,
        emitter_name: parsed.emitter_name,
        emitter_trade_name: parsed.emitter_trade_name,
        emitter_state_tax_id: parsed.emitter_state_tax_id,
        emitter_address: parsed.emitter_address,
        recipient_tax_id: parsed.recipient_tax_id,
        recipient_name: parsed.recipient_name,
        total_products: parsed.total_products,
        total_discount: parsed.total_discount,
        total_freight: parsed.total_freight,
        total_invoice: parsed.total_invoice,
        items_count: parsed.items.length,
        supplier_id: supplierId,
        warehouse_id: (warehouse?.id ?? null) as string | null,
        status: "importado",
        raw_xml: xml,
        imported_by: context.userId,
      })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505" || /duplicate key/i.test(insertError.message)) {
        throw new Error("Esta NF-e já foi importada anteriormente.");
      }
      throw new Error(insertError.message);
    }

    const importId = inserted.id as string;

    // Candidatos de produto por GTIN e códigos presentes no XML.
    const codes = [...new Set(parsed.items.map((item) => normalizeCode(item.supplier_code)).filter(Boolean))] as string[];
    const gtins = [...new Set(parsed.items.map((item) => item.gtin).filter(Boolean))] as string[];

    let products: ProductCandidate[] = [];
    if (codes.length > 0 || gtins.length > 0) {
      const filters: string[] = [];
      if (codes.length > 0) {
        const list = `(${codes.map((c) => `"${c}"`).join(",")})`;
        filters.push(`manufacturer_code.in.${list}`, `internal_code.in.${list}`, `sku.in.${list}`);
      }
      if (gtins.length > 0) filters.push(`gtin.in.(${gtins.join(",")})`);

      const { data: rows, error } = await sb
        .from("products")
        .select(NFE_PRODUCT_SELECT)
        .eq("tenant_id", context.tenantId)
        .or(filters.join(","))
        .limit(1000);
      if (error) throw new Error(error.message);
      products = (rows ?? []) as ProductCandidate[];
    }

    const supplierCodeMap = new Map<string, string>();
    if (supplierId && codes.length > 0) {
      const { data: learned } = await sb
        .from("supplier_product_codes")
        .select("supplier_code, product_id")
        .eq("tenant_id", context.tenantId)
        .eq("supplier_id", supplierId)
        .in("supplier_code", codes);
      for (const row of learned ?? []) {
        supplierCodeMap.set(String(row.supplier_code).toUpperCase(), row.product_id as string);
      }
    }

    const rows = parsed.items.map((item) => {
      const match = matchNfeItem(item, products, supplierCodeMap);
      const unitCost = effectiveUnitCost(item);
      const product = products.find((p) => p.id === match.product_id) ?? null;
      const divergences = itemDivergences({
        matched: Boolean(match.product_id),
        xmlQty: item.qty,
        xmlUnitCost: unitCost,
        lastCost: product?.last_purchase_cost ?? null,
      });

      return {
        tenant_id: context.tenantId,
        nfe_import_id: importId,
        line_number: item.line_number,
        supplier_code: item.supplier_code,
        gtin: item.gtin,
        description: item.description,
        ncm: item.ncm,
        cfop: item.cfop,
        unit: item.unit,
        qty: item.qty,
        unit_value: item.unit_value,
        discount_amount: item.discount_amount,
        freight_amount: item.freight_amount,
        other_amount: item.other_amount,
        total_amount: item.total_amount,
        product_id: match.product_id,
        match_source: match.match_source,
        match_confidence: confidenceFor(match.match_source),
        divergences,
      };
    });

    const { error: itemsError } = await sb.from("nfe_import_items").insert(rows);
    if (itemsError) {
      await sb.from("nfe_imports").delete().eq("id", importId).eq("tenant_id", context.tenantId);
      throw new Error(itemsError.message);
    }

    const status = deriveNfeStatus("importado", rows);
    await sb
      .from("nfe_imports")
      .update({ status })
      .eq("id", importId)
      .eq("tenant_id", context.tenantId);

    return {
      ok: true,
      id: importId,
      duplicated: false,
      status,
      supplierFound: Boolean(supplierId),
      emitter: {
        tax_id: parsed.emitter_tax_id,
        name: parsed.emitter_name,
        trade_name: parsed.emitter_trade_name,
      },
    };
  });

// ===================== Listagem e detalhe =====================

export const listNfeImports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { status?: NfeStatus | "all"; search?: string }) => input ?? {})
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);

    let query = sb
      .from("nfe_imports")
      .select(IMPORT_SELECT)
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status && data.status !== "all") query = query.eq("status", data.status);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const term = (data.search ?? "").trim().toLowerCase();
    const list = rows ?? [];
    if (!term) return list;
    return list.filter((row: any) =>
      [row.access_key, row.nfe_number?.toString(), row.emitter_name, row.emitter_tax_id, row.file_name]
        .filter(Boolean)
        .some((value: string) => value.toLowerCase().includes(term)),
    );
  });

export const getNfeImport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);

    const { data: header, error } = await sb
      .from("nfe_imports")
      .select(IMPORT_SELECT)
      .eq("tenant_id", context.tenantId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!header) throw new Error("Importação de NF-e não encontrada");

    const { data: items, error: itemsError } = await sb
      .from("nfe_import_items")
      .select(ITEM_SELECT)
      .eq("tenant_id", context.tenantId)
      .eq("nfe_import_id", data.id)
      .order("line_number");
    if (itemsError) throw new Error(itemsError.message);

    let orderItems: any[] = [];
    if (header.purchase_order_id) {
      const { data: rows, error: orderError } = await sb
        .from("purchase_order_items")
        .select("id, product_id, ordered_qty, received_qty, unit_cost")
        .eq("tenant_id", context.tenantId)
        .eq("purchase_order_id", header.purchase_order_id);
      if (orderError) throw new Error(orderError.message);
      orderItems = rows ?? [];
    }

    return { header, items: items ?? [], orderItems };
  });

// ===================== Fornecedor assistido =====================

export const createSupplierFromNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string; confirm: true }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);
    if (data.confirm !== true) throw new Error("Confirmação obrigatória para cadastrar o fornecedor");

    const { data: header, error } = await sb
      .from("nfe_imports")
      .select("id, supplier_id, emitter_tax_id, emitter_name, emitter_trade_name, emitter_state_tax_id, emitter_address")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.importId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!header) throw new Error("Importação de NF-e não encontrada");
    if (header.supplier_id) return { ok: true, id: header.supplier_id as string, created: false };

    const address = (header.emitter_address ?? {}) as Record<string, string | null>;
    const { data: existing } = await sb
      .from("suppliers")
      .select("id")
      .eq("tenant_id", context.tenantId)
      .eq("tax_id", header.emitter_tax_id)
      .maybeSingle();

    let supplierId = (existing?.id ?? null) as string | null;
    if (!supplierId) {
      const { data: created, error: createError } = await sb
        .from("suppliers")
        .insert({
          tenant_id: context.tenantId,
          legal_name: header.emitter_name,
          trade_name: header.emitter_trade_name,
          tax_id: header.emitter_tax_id,
          state_tax_id: header.emitter_state_tax_id,
          phone: address.phone ?? null,
          address: [address.street, address.number, address.district].filter(Boolean).join(", ") || null,
          city: address.city ?? null,
          state: address.state ?? null,
          zip_code: address.zip_code ?? null,
          active: true,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (createError) throw new Error(createError.message);
      supplierId = created.id as string;
    }

    const { error: linkError } = await sb
      .from("nfe_imports")
      .update({ supplier_id: supplierId })
      .eq("id", data.importId)
      .eq("tenant_id", context.tenantId);
    if (linkError) throw new Error(linkError.message);

    return { ok: true, id: supplierId, created: !existing };
  });

export const linkNfeSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string; supplierId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);
    const { error } = await sb
      .from("nfe_imports")
      .update({ supplier_id: data.supplierId })
      .eq("id", data.importId)
      .eq("tenant_id", context.tenantId)
      .in("status", ["importado", "em_conferencia", "divergente", "pronto"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===================== Conferência =====================

async function recalcImport(sb: any, tenantId: string, importId: string) {
  const { data: header } = await sb
    .from("nfe_imports")
    .select("id, status, purchase_order_id")
    .eq("tenant_id", tenantId)
    .eq("id", importId)
    .maybeSingle();
  if (!header) throw new Error("Importação de NF-e não encontrada");
  if (header.status === "confirmado" || header.status === "cancelado") {
    throw new Error("NF-e confirmada ou cancelada não pode mais ser alterada");
  }

  const { data: items } = await sb
    .from("nfe_import_items")
    .select(
      "id, line_number, qty, unit_value, total_amount, discount_amount, freight_amount, other_amount, product_id, purchase_order_item_id, product:products(id, last_purchase_cost)",
    )
    .eq("tenant_id", tenantId)
    .eq("nfe_import_id", importId)
    .order("line_number");

  let orderItems: any[] = [];
  if (header.purchase_order_id) {
    const { data: rows } = await sb
      .from("purchase_order_items")
      .select("id, product_id, ordered_qty, received_qty, unit_cost")
      .eq("tenant_id", tenantId)
      .eq("purchase_order_id", header.purchase_order_id);
    orderItems = rows ?? [];
  }

  const summary: { product_id: string | null; divergences: ItemDivergence[] }[] = [];

  for (const item of items ?? []) {
    const orderItem =
      orderItems.find((row) => row.id === item.purchase_order_item_id) ??
      (item.product_id ? orderItems.find((row) => row.product_id === item.product_id) : null) ??
      null;

    const unitCost = effectiveUnitCost(item as any);
    const divergences = itemDivergences({
      matched: Boolean(item.product_id),
      xmlQty: Number(item.qty),
      xmlUnitCost: unitCost,
      orderQty: orderItem ? Number(orderItem.ordered_qty) : null,
      orderReceivedQty: orderItem ? Number(orderItem.received_qty) : null,
      orderUnitCost: orderItem ? Number(orderItem.unit_cost) : null,
      lastCost: item.product?.last_purchase_cost ?? null,
    });

    await sb
      .from("nfe_import_items")
      .update({ divergences, purchase_order_item_id: orderItem?.id ?? null })
      .eq("id", item.id)
      .eq("tenant_id", tenantId);

    summary.push({ product_id: item.product_id ?? null, divergences });
  }

  const status = deriveNfeStatus(header.status as NfeStatus, summary);
  const allDivergences = summary.flatMap((row) => row.divergences);
  await sb
    .from("nfe_imports")
    .update({ status, divergences: allDivergences })
    .eq("id", importId)
    .eq("tenant_id", tenantId);

  return { ok: true, status };
}

export const setNfeItemProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string; itemId: string; productId: string | null; remember?: boolean }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);

    const { data: item, error } = await sb
      .from("nfe_import_items")
      .select("id, supplier_code, nfe_import_id")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.itemId)
      .eq("nfe_import_id", data.importId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!item) throw new Error("Item da NF-e não encontrado");

    const source: MatchSource = data.productId ? "manual" : "none";
    const { error: updateError } = await sb
      .from("nfe_import_items")
      .update({
        product_id: data.productId,
        match_source: source,
        match_confidence: confidenceFor(source),
      })
      .eq("id", data.itemId)
      .eq("tenant_id", context.tenantId);
    if (updateError) throw new Error(updateError.message);

    if (data.remember && data.productId && item.supplier_code) {
      const { data: header } = await sb
        .from("nfe_imports")
        .select("supplier_id")
        .eq("tenant_id", context.tenantId)
        .eq("id", data.importId)
        .maybeSingle();
      if (header?.supplier_id) {
        await sb.from("supplier_product_codes").upsert(
          {
            tenant_id: context.tenantId,
            supplier_id: header.supplier_id,
            supplier_code: normalizeCode(item.supplier_code),
            product_id: data.productId,
            created_by: context.userId,
          },
          { onConflict: "tenant_id,supplier_id,supplier_code" },
        );
      }
    }

    return recalcImport(sb, context.tenantId, data.importId);
  });

export const setNfePurchaseOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      importId: string;
      purchaseOrderId: string | null;
      warehouseId?: string | null;
      noOrderReason?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);

    const patch: Record<string, unknown> = {
      purchase_order_id: data.purchaseOrderId,
      no_order_reason: data.purchaseOrderId ? null : (data.noOrderReason ?? "").trim() || null,
    };

    if (data.purchaseOrderId) {
      const { data: order, error } = await sb
        .from("purchase_orders")
        .select("id, status, supplier_id, warehouse_id")
        .eq("tenant_id", context.tenantId)
        .eq("id", data.purchaseOrderId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!order) throw new Error("Pedido de compra não encontrado");
      if (!["approved", "sent", "partially_received"].includes(order.status)) {
        throw new Error(`Pedido com status ${order.status} não aceita recebimento`);
      }
      patch.warehouse_id = order.warehouse_id;
      patch.supplier_id = order.supplier_id;
    } else {
      if (!(data.noOrderReason ?? "").trim()) {
        throw new Error("Entrada sem pedido de compra exige justificativa");
      }
      if (data.warehouseId) patch.warehouse_id = data.warehouseId;
    }

    const { error: updateError } = await sb
      .from("nfe_imports")
      .update(patch)
      .eq("id", data.importId)
      .eq("tenant_id", context.tenantId)
      .in("status", ["importado", "em_conferencia", "divergente", "pronto"]);
    if (updateError) throw new Error(updateError.message);

    return recalcImport(sb, context.tenantId, data.importId);
  });

export const revalidateNfeImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_READ_ROLES);
    return recalcImport(sb, context.tenantId, data.importId);
  });

export const cancelNfeImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string; reason: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_APPROVE_ROLES);
    if (!(data.reason ?? "").trim()) throw new Error("Informe o motivo do cancelamento");

    const { data: header, error } = await sb
      .from("nfe_imports")
      .select("id, status")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.importId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!header) throw new Error("Importação de NF-e não encontrada");
    if (header.status === "confirmado") throw new Error("NF-e já confirmada não pode ser cancelada");

    const { error: updateError } = await sb
      .from("nfe_imports")
      .update({ status: "cancelado", cancel_reason: data.reason.trim() })
      .eq("id", data.importId)
      .eq("tenant_id", context.tenantId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true, status: "cancelado" as NfeStatus };
  });

// ===================== Geração do recebimento =====================

/**
 * Cria `goods_receipt` + `goods_receipt_items` em RASCUNHO a partir da NF-e
 * conferida. Nenhum estoque ou custo é movimentado aqui: a movimentação é
 * exclusividade da função transacional `confirm_goods_receipt`.
 */
type NfePackagingInput = {
  receivedPackageQty?: number;
  rejectedPackageQty?: number;
  unitsPerPackage?: number;
  packageUnit?: string | null;
};

/**
 * Cria `goods_receipt` + `goods_receipt_items` em RASCUNHO a partir da NF-e
 * conferida. A conversão de embalagem é validada no servidor e o estoque só
 * é movimentado pela função transacional `confirm_goods_receipt`.
 */
export const createReceiptFromNfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      importId: string;
      packaging?: Record<string, NfePackagingInput>;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireSupplyRole(sb, context.userId, context.tenantId, SUPPLY_WRITE_ROLES);

    const { data: header, error } = await sb
      .from("nfe_imports")
      .select(
        "id, status, supplier_id, warehouse_id, purchase_order_id, no_order_reason, goods_receipt_id, access_key, nfe_number",
      )
      .eq("tenant_id", context.tenantId)
      .eq("id", data.importId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!header) throw new Error("Importação de NF-e não encontrada");
    if (header.status === "cancelado") throw new Error("NF-e cancelada não gera recebimento");
    if (header.goods_receipt_id) {
      // idempotência: uma NF-e gera um único recebimento
      return { ok: true, receiptId: header.goods_receipt_id as string, created: false };
    }
    if (!header.supplier_id) throw new Error("Vincule o fornecedor antes de gerar o recebimento");
    if (!header.warehouse_id) throw new Error("Selecione o depósito de entrada");
    if (!header.purchase_order_id && !(header.no_order_reason ?? "").trim()) {
      throw new Error("Entrada sem pedido de compra exige justificativa");
    }

    const { data: items, error: itemsError } = await sb
      .from("nfe_import_items")
      .select(
        "id, line_number, qty, unit, unit_value, total_amount, discount_amount, freight_amount, other_amount, product_id, purchase_order_item_id",
      )
      .eq("tenant_id", context.tenantId)
      .eq("nfe_import_id", data.importId)
      .order("line_number");
    if (itemsError) throw new Error(itemsError.message);

    const list = items ?? [];
    if (list.length === 0) throw new Error("NF-e sem itens");
    const unmatched = list.filter((item: any) => !item.product_id);
    if (unmatched.length > 0) {
      throw new Error(
        `Vincule os produtos das linhas ${unmatched.map((item: any) => item.line_number).join(", ")} antes de gerar o recebimento`,
      );
    }

    const rows = list.map((item: any) => {
      const xmlQty = round2(Number(item.qty));
      const raw = data.packaging?.[item.id] ?? {};
      const receivedPackageQty = round2(
        raw.receivedPackageQty == null ? xmlQty : Number(raw.receivedPackageQty),
      );
      const rejectedPackageQty = round2(
        raw.rejectedPackageQty == null ? 0 : Number(raw.rejectedPackageQty),
      );
      const unitsPerPackage = Number(raw.unitsPerPackage ?? 1);
      const packageUnit = String(raw.packageUnit ?? item.unit ?? "UN").trim().toUpperCase() || "UN";

      if (!Number.isFinite(xmlQty) || xmlQty <= 0) {
        throw new Error(`Quantidade inválida na linha ${item.line_number} da NF-e`);
      }
      if (
        !Number.isFinite(receivedPackageQty) ||
        receivedPackageQty <= 0 ||
        !Number.isFinite(rejectedPackageQty) ||
        rejectedPackageQty < 0 ||
        !Number.isSafeInteger(unitsPerPackage) ||
        unitsPerPackage <= 0
      ) {
        throw new Error(`Conversão inválida na linha ${item.line_number} da NF-e`);
      }
      if (rejectedPackageQty > receivedPackageQty) {
        throw new Error(`Recusadas acima das recebidas na linha ${item.line_number}`);
      }
      if (!/^[A-Z][A-Z0-9_]{0,9}$/.test(packageUnit)) {
        throw new Error(`Unidade de embalagem inválida na linha ${item.line_number}`);
      }

      const convertedTotal = round2(receivedPackageQty * unitsPerPackage);
      const expectedTotal = round2(xmlQty);
      if (Math.abs(convertedTotal - expectedTotal) > 0.01) {
        throw new Error(
          `A conversão da linha ${item.line_number} deve totalizar ${expectedTotal} unidades-base (NF-e: ${expectedTotal})`,
        );
      }

      return {
        tenant_id: context.tenantId,
        purchase_order_item_id: item.purchase_order_item_id ?? null,
        product_id: item.product_id,
        accepted_qty: round2((receivedPackageQty - rejectedPackageQty) * unitsPerPackage),
        rejected_qty: round2(rejectedPackageQty * unitsPerPackage),
        received_package_qty: receivedPackageQty,
        rejected_package_qty: rejectedPackageQty,
        units_per_package: unitsPerPackage,
        package_unit: packageUnit,
        unit_cost: effectiveUnitCost(item),
        notes: `NF-e item ${item.line_number}`,
      };
    });

    const { data: receipt, error: receiptError } = await sb
      .from("goods_receipts")
      .insert({
        tenant_id: context.tenantId,
        purchase_order_id: header.purchase_order_id,
        supplier_id: header.supplier_id,
        warehouse_id: header.warehouse_id,
        status: "draft",
        received_at: new Date().toISOString().slice(0, 10),
        invoice_number: String(header.nfe_number ?? ""),
        no_order_reason: header.purchase_order_id ? null : header.no_order_reason,
        notes: `NF-e ${header.access_key}`,
        created_by: context.userId,
      })
      .select("id, number")
      .single();
    if (receiptError) throw new Error(receiptError.message);

    const rowsWithReceipt = rows.map((row) => ({ ...row, goods_receipt_id: receipt.id }));
    const { error: insertError } = await sb.from("goods_receipt_items").insert(rowsWithReceipt);
    if (insertError) {
      await sb.from("goods_receipts").delete().eq("id", receipt.id).eq("tenant_id", context.tenantId);
      throw new Error(insertError.message);
    }

    const { error: linkError } = await sb
      .from("nfe_imports")
      .update({ goods_receipt_id: receipt.id })
      .eq("id", data.importId)
      .eq("tenant_id", context.tenantId);
    if (linkError) {
      await sb.from("goods_receipts").delete().eq("id", receipt.id).eq("tenant_id", context.tenantId);
      throw new Error(linkError.message);
    }

    return { ok: true, receiptId: receipt.id as string, receiptNumber: receipt.number as number, created: true };
  });
