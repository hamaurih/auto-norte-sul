import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

/**
 * Operação do PDV: histórico de vendas, detalhe, cancelamento e relatório de
 * caixa. Todas as leituras usam o cliente autenticado do middleware (RLS ativa)
 * e o `tenantId` resolvido no servidor — nada de tenant, preço, papel ou
 * operador enviados pelo navegador.
 */

export type PosSaleStatus = "completed" | "cancelled" | "refunded" | string;

export type PosSaleListRow = {
  id: string;
  code: string;
  created_at: string;
  status: PosSaleStatus;
  total: number;
  subtotal: number;
  discount_amount: number;
  fiscal_status: string | null;
  cancelled_at: string | null;
  terminal_code: string | null;
  operator_id: string | null;
  operator_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  payment_methods: string[];
};

export type PosSaleDetail = PosSaleListRow & {
  warehouse_id: string | null;
  warehouse_name: string | null;
  cash_session_id: string | null;
  customer_document: string | null;
  cancel_reason: string | null;
  items: Array<{
    id: string;
    product_id: string | null;
    sku: string | null;
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
  payments: Array<{
    id: string;
    method: string;
    amount: number;
    installments: number | null;
    provider: string | null;
    provider_reference: string | null;
    status: string | null;
  }>;
};

const SALE_CODE_LENGTH = 8;
const CANCEL_ROLES = ["owner", "admin", "manager"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_PREFIX_RE = /^[0-9a-f]{4,8}$/i;

const saleCode = (id: string) => id.slice(0, SALE_CODE_LENGTH).toUpperCase();

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function nameMaps(
  sb: ReturnType<typeof tdb>,
  tenantId: string,
  operatorIds: string[],
  customerIds: string[],
) {
  const operators = new Map<string, string>();
  const customers = new Map<string, { name: string; document: string | null }>();

  if (operatorIds.length) {
    const { data } = await sb.from("profiles").select("id, full_name").in("id", operatorIds);
    for (const row of data ?? []) operators.set(row.id as string, (row.full_name as string) ?? "");
  }
  if (customerIds.length) {
    const { data } = await sb
      .from("customers")
      .select("id, name, document")
      .eq("tenant_id", tenantId)
      .in("id", customerIds);
    for (const row of data ?? []) {
      customers.set(row.id as string, {
        name: (row.name as string) ?? "",
        document: (row.document as string) ?? null,
      });
    }
  }
  return { operators, customers };
}

export const listPosSales = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      page?: number;
      pageSize?: number;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      status?: string;
      operatorId?: string;
      terminalCode?: string;
      paymentMethod?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const page = Math.max(1, Math.trunc(data.page ?? 1));
    const pageSize = Math.min(50, Math.max(5, Math.trunc(data.pageSize ?? 20)));
    const from = (page - 1) * pageSize;

    const sessionJoin = data.terminalCode ? "!inner" : "";
    const paymentJoin = data.paymentMethod ? "!inner" : "";
    const select =
      "id, created_at, status, subtotal, discount_amount, total, fiscal_status, cancelled_at," +
      ` operator_id, customer_id, session:pos_cash_sessions${sessionJoin}(terminal_code),` +
      ` payments:pos_payments${paymentJoin}(method)`;

    let query = sb
      .from("pos_sales")
      .select(select, { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (data.status) query = query.eq("status", data.status);
    if (data.operatorId) query = query.eq("operator_id", data.operatorId);
    if (data.terminalCode) query = query.eq("session.terminal_code", data.terminalCode);
    if (data.paymentMethod) query = query.eq("payments.method", data.paymentMethod);
    if (data.dateFrom) query = query.gte("created_at", new Date(`${data.dateFrom}T00:00:00`).toISOString());
    if (data.dateTo) query = query.lte("created_at", new Date(`${data.dateTo}T23:59:59.999`).toISOString());

    const term = (data.search ?? "").trim();
    if (term) {
      const clauses: string[] = [];
      if (UUID_RE.test(term)) {
        clauses.push(`id.eq.${term}`);
      } else if (HEX_PREFIX_RE.test(term)) {
        const prefix = term.toLowerCase().padEnd(8, "0");
        const upper = term.toLowerCase().padEnd(8, "f");
        clauses.push(
          `and(id.gte.${prefix}-0000-0000-0000-000000000000,id.lte.${upper}-ffff-ffff-ffff-ffffffffffff)`,
        );
      }
      const { data: matched } = await sb
        .from("customers")
        .select("id")
        .eq("tenant_id", context.tenantId)
        .or(`name.ilike.%${term}%,document.ilike.%${term}%`)
        .limit(50);
      const ids = (matched ?? []).map((row: any) => row.id as string);
      if (ids.length) clauses.push(`customer_id.in.(${ids.join(",")})`);
      if (!clauses.length) return { rows: [] as PosSaleListRow[], total: 0, page, pageSize };
      query = query.or(clauses.join(","));
    }

    const { data: sales, error, count } = await query;
    if (error) throw new Error(error.message);

    const rows = (sales ?? []) as any[];
    const { operators, customers } = await nameMaps(
      sb,
      context.tenantId,
      [...new Set(rows.map((r) => r.operator_id).filter(Boolean))] as string[],
      [...new Set(rows.map((r) => r.customer_id).filter(Boolean))] as string[],
    );

    return {
      page,
      pageSize,
      total: count ?? rows.length,
      rows: rows.map((row): PosSaleListRow => ({
        id: row.id,
        code: saleCode(row.id),
        created_at: row.created_at,
        status: row.status,
        total: num(row.total),
        subtotal: num(row.subtotal),
        discount_amount: num(row.discount_amount),
        fiscal_status: row.fiscal_status ?? null,
        cancelled_at: row.cancelled_at ?? null,
        terminal_code: row.session?.terminal_code ?? null,
        operator_id: row.operator_id ?? null,
        operator_name: row.operator_id ? operators.get(row.operator_id) || null : null,
        customer_id: row.customer_id ?? null,
        customer_name: row.customer_id ? customers.get(row.customer_id)?.name || null : null,
        payment_methods: [...new Set(((row.payments ?? []) as any[]).map((p) => String(p.method)))],
      })),
    };
  });

export const getPosSaleDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { saleId: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const { data: sale, error } = await sb
      .from("pos_sales")
      .select(
        "id, created_at, status, subtotal, discount_amount, total, fiscal_status, cancelled_at," +
          " operator_id, customer_id, warehouse_id, cash_session_id," +
          " session:pos_cash_sessions(terminal_code)," +
          " items:pos_sale_items(id, product_id, quantity, unit_price, line_total, product:products(sku, name))," +
          " payments:pos_payments(id, method, amount, installments, provider, provider_reference, status)",
      )
      .eq("tenant_id", context.tenantId)
      .eq("id", data.saleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!sale) throw new Error("Venda não encontrada para esta empresa.");

    const row = sale as any;
    const { operators, customers } = await nameMaps(
      sb,
      context.tenantId,
      row.operator_id ? [row.operator_id] : [],
      row.customer_id ? [row.customer_id] : [],
    );

    let warehouseName: string | null = null;
    if (row.warehouse_id) {
      const { data: warehouse } = await sb
        .from("warehouses")
        .select("name")
        .eq("id", row.warehouse_id)
        .maybeSingle();
      warehouseName = (warehouse?.name as string) ?? null;
    }

    let cancelReason: string | null = null;
    if (row.cancelled_at) {
      const { data: events } = await sb
        .from("audit_events")
        .select("action, metadata, after_data, created_at")
        .eq("tenant_id", context.tenantId)
        .eq("resource_id", row.id)
        .order("created_at", { ascending: false })
        .limit(10);
      const event = (events ?? []).find((e: any) => String(e.action ?? "").includes("cancel"));
      const bag = { ...(event?.metadata ?? {}), ...(event?.after_data ?? {}) } as Record<string, unknown>;
      const found = bag["reason"] ?? bag["p_reason"] ?? bag["cancel_reason"] ?? bag["motivo"];
      cancelReason = typeof found === "string" && found.trim() ? found : null;
    }

    const detail: PosSaleDetail = {
      id: row.id,
      code: saleCode(row.id),
      created_at: row.created_at,
      status: row.status,
      total: num(row.total),
      subtotal: num(row.subtotal),
      discount_amount: num(row.discount_amount),
      fiscal_status: row.fiscal_status ?? null,
      cancelled_at: row.cancelled_at ?? null,
      terminal_code: row.session?.terminal_code ?? null,
      operator_id: row.operator_id ?? null,
      operator_name: row.operator_id ? operators.get(row.operator_id) || null : null,
      customer_id: row.customer_id ?? null,
      customer_name: row.customer_id ? customers.get(row.customer_id)?.name || null : null,
      customer_document: row.customer_id ? customers.get(row.customer_id)?.document ?? null : null,
      warehouse_id: row.warehouse_id ?? null,
      warehouse_name: warehouseName,
      cash_session_id: row.cash_session_id ?? null,
      cancel_reason: cancelReason,
      payment_methods: [...new Set(((row.payments ?? []) as any[]).map((p) => String(p.method)))],
      items: (row.items ?? []).map((item: any) => ({
        id: item.id,
        product_id: item.product_id ?? null,
        sku: item.product?.sku ?? null,
        name: item.product?.name ?? "Produto removido",
        quantity: num(item.quantity),
        unit_price: num(item.unit_price),
        line_total: num(item.line_total),
      })),
      payments: (row.payments ?? []).map((payment: any) => ({
        id: payment.id,
        method: payment.method,
        amount: num(payment.amount),
        installments: payment.installments ?? null,
        provider: payment.provider ?? null,
        provider_reference: payment.provider_reference ?? null,
        status: payment.status ?? null,
      })),
    };
    return detail;
  });

/** Papel efetivo do usuário no tenant ativo, resolvido no servidor. */
async function tenantRole(sb: ReturnType<typeof tdb>, tenantId: string, userId: string) {
  const { data } = await sb
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (data?.role) return String(data.role);
  const { data: legacy } = await sb.from("user_roles").select("role").eq("user_id", userId);
  const roles = (legacy ?? []).map((r: any) => String(r.role));
  if (roles.includes("admin")) return "admin";
  if (roles.includes("gerente")) return "manager";
  return null;
}

export const getPosPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await tenantRole(tdb(context.supabase), context.tenantId, context.userId);
    return { role, canCancel: Boolean(role && CANCEL_ROLES.includes(role)) };
  });

export const cancelPosSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { saleId: string; reason: string }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    const reason = (data.reason ?? "").trim();
    if (reason.length < 5) throw new Error("Informe um motivo com pelo menos 5 caracteres.");

    const role = await tenantRole(sb, context.tenantId, context.userId);
    if (!role || !CANCEL_ROLES.includes(role)) {
      throw new Error("Somente proprietário, administrador ou gerente podem cancelar vendas.");
    }

    const { data: sale, error: saleError } = await sb
      .from("pos_sales")
      .select("id, status, cancelled_at, fiscal_status, payments:pos_payments(method, provider, provider_reference)")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.saleId)
      .maybeSingle();
    if (saleError) throw new Error(saleError.message);
    if (!sale) throw new Error("Venda não encontrada para esta empresa.");

    const current = sale as any;
    if (current.cancelled_at || ["cancelled", "refunded"].includes(String(current.status))) {
      throw new Error("Esta venda já está cancelada.");
    }

    const fiscal = String(current.fiscal_status ?? "").toLowerCase();
    if (["authorized", "autorizada", "autorizado", "issued", "emitida"].includes(fiscal)) {
      throw new Error(
        "Venda com documento fiscal autorizado: emita a nota de cancelamento/devolução no fiscal antes de cancelar no PDV.",
      );
    }

    const { error } = await sb.rpc("cancel_pos_sale", { p_sale_id: data.saleId, p_reason: reason });
    if (error) {
      const message = error.message || "";
      if (/permission denied|not authorized|forbidden/i.test(message)) {
        throw new Error("Seu usuário não tem permissão para cancelar vendas neste caixa.");
      }
      if (/already|cancel/i.test(message) && /cancel/i.test(message)) {
        throw new Error(`Não foi possível cancelar: ${message}`);
      }
      throw new Error(message || "Falha ao cancelar a venda.");
    }

    const warnings: string[] = [];
    const externals = ((current.payments ?? []) as any[]).filter(
      (p) => p.provider || p.provider_reference,
    );
    if (externals.length) {
      warnings.push(
        "Existem pagamentos processados por adquirente/provedor externo. O estorno precisa ser feito também no provedor: " +
          externals.map((p) => `${p.method}${p.provider ? ` (${p.provider})` : ""}`).join(", "),
      );
    }
    if (fiscal && fiscal !== "none" && fiscal !== "pending") {
      warnings.push(`Situação fiscal registrada como "${fiscal}": confira o documento no módulo fiscal.`);
    }
    return { ok: true, reason, cancelledAt: new Date().toISOString(), warnings };
  });

export const listPosFilterOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    const { data, error } = await sb
      .from("pos_cash_sessions")
      .select("terminal_code, operator_id")
      .eq("tenant_id", context.tenantId)
      .order("opened_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];
    const terminals = [...new Set(rows.map((r) => r.terminal_code).filter(Boolean))].sort();
    const operatorIds = [...new Set(rows.map((r) => r.operator_id).filter(Boolean))] as string[];
    const { operators } = await nameMaps(sb, context.tenantId, operatorIds, []);
    return {
      terminals: terminals as string[],
      operators: operatorIds.map((id) => ({ id, name: operators.get(id) || "Operador sem nome" })),
    };
  });

export type PosCashReportSession = {
  id: string;
  terminal_code: string | null;
  operator_id: string | null;
  operator_name: string | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  counted_amount: number | null;
  expected_amount: number | null;
  difference_amount: number | null;
  supplies: number;
  withdrawals: number;
  sales_count: number;
  cancelled_count: number;
  sales_total: number;
  by_method: Record<string, number>;
  notes: string | null;
};

export const getPosCashReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { dateFrom?: string; dateTo?: string; operatorId?: string; terminalCode?: string }) => input,
  )
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    let query = sb
      .from("pos_cash_sessions")
      .select(
        "id, terminal_code, operator_id, status, opened_at, closed_at, opening_amount," +
          " counted_amount, expected_amount, difference_amount, notes," +
          " movements:pos_cash_movements(type, amount)," +
          " sales:pos_sales(id, status, total, payments:pos_payments(method, amount))",
      )
      .eq("tenant_id", context.tenantId)
      .order("opened_at", { ascending: false })
      .limit(200);

    if (data.operatorId) query = query.eq("operator_id", data.operatorId);
    if (data.terminalCode) query = query.eq("terminal_code", data.terminalCode);
    if (data.dateFrom) query = query.gte("opened_at", new Date(`${data.dateFrom}T00:00:00`).toISOString());
    if (data.dateTo) query = query.lte("opened_at", new Date(`${data.dateTo}T23:59:59.999`).toISOString());

    const { data: sessions, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (sessions ?? []) as any[];
    const { operators } = await nameMaps(
      sb,
      context.tenantId,
      [...new Set(rows.map((r) => r.operator_id).filter(Boolean))] as string[],
      [],
    );

    const list = rows.map((row): PosCashReportSession => {
      const movements = (row.movements ?? []) as any[];
      const supplies = movements
        .filter((m) => m.type === "supply")
        .reduce((sum, m) => sum + num(m.amount), 0);
      const withdrawals = movements
        .filter((m) => m.type === "withdrawal")
        .reduce((sum, m) => sum + num(m.amount), 0);

      const sales = (row.sales ?? []) as any[];
      const valid = sales.filter((s) => !["cancelled", "refunded"].includes(String(s.status)));
      const byMethod: Record<string, number> = {};
      for (const sale of valid) {
        for (const payment of (sale.payments ?? []) as any[]) {
          byMethod[payment.method] = num(byMethod[payment.method]) + num(payment.amount);
        }
      }
      const cashSales = num(byMethod["cash"]);
      const expected =
        row.expected_amount === null || row.expected_amount === undefined
          ? num(row.opening_amount) + cashSales + supplies - withdrawals
          : num(row.expected_amount);
      const counted = row.counted_amount === null || row.counted_amount === undefined ? null : num(row.counted_amount);

      return {
        id: row.id,
        terminal_code: row.terminal_code ?? null,
        operator_id: row.operator_id ?? null,
        operator_name: row.operator_id ? operators.get(row.operator_id) || null : null,
        status: row.status,
        opened_at: row.opened_at,
        closed_at: row.closed_at ?? null,
        opening_amount: num(row.opening_amount),
        counted_amount: counted,
        expected_amount: expected,
        difference_amount:
          row.difference_amount === null || row.difference_amount === undefined
            ? counted === null
              ? null
              : counted - expected
            : num(row.difference_amount),
        supplies,
        withdrawals,
        sales_count: valid.length,
        cancelled_count: sales.length - valid.length,
        sales_total: valid.reduce((sum, s) => sum + num(s.total), 0),
        by_method: byMethod,
        notes: row.notes ?? null,
      };
    });

    const totals = list.reduce(
      (acc, session) => {
        acc.sessions += 1;
        acc.sales_count += session.sales_count;
        acc.sales_total += session.sales_total;
        acc.supplies += session.supplies;
        acc.withdrawals += session.withdrawals;
        acc.difference += session.difference_amount ?? 0;
        for (const [method, value] of Object.entries(session.by_method)) {
          acc.by_method[method] = num(acc.by_method[method]) + value;
        }
        return acc;
      },
      {
        sessions: 0,
        sales_count: 0,
        sales_total: 0,
        supplies: 0,
        withdrawals: 0,
        difference: 0,
        by_method: {} as Record<string, number>,
      },
    );

    return { sessions: list, totals };
  });

export const getPosCompanyHeader = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = tdb(context.supabase);
    const { data } = await sb
      .from("tenant_company_profiles")
      .select("legal_name, trade_name, tax_id, phone, address_street, address_number, address_city, address_state")
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    const row = (data ?? {}) as any;
    return {
      legal_name: (row.legal_name as string) ?? null,
      trade_name: (row.trade_name as string) ?? null,
      tax_id: (row.tax_id as string) ?? null,
      phone: (row.phone as string) ?? null,
      address: [
        [row.address_street, row.address_number].filter(Boolean).join(", "),
        [row.address_city, row.address_state].filter(Boolean).join(" - "),
      ]
        .filter(Boolean)
        .join(" · ") || null,
    };
  });
