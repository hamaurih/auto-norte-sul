import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireTenantRole } from "@/lib/auth-guards";

export type B2BPriceTable = "A" | "B" | "C";
export type B2BCustomerGroup = "revendedor" | "oficina" | "distribuidor";

export type B2BCommercialProfile = {
  approved: boolean;
  pending: boolean;
  rejected: boolean;
  customerGroup: "b2c" | "b2b_pendente" | B2BCustomerGroup;
  priceTable: B2BPriceTable | null;
  discountPct: number;
  allowedBoletoDays: number[];
  allowInvoice: boolean;
  invoiceDueDays: number | null;
  maxCardInstallments: number;
  registrationStatus: "pendente" | "aprovado" | "reprovado" | null;
};

const registrationSchema = z.object({
  cnpj: z.string().trim().min(14).max(20),
  razao_social: z.string().trim().min(3).max(200),
  nome_fantasia: z.string().trim().max(200).optional().or(z.literal("")),
  whatsapp: z.string().trim().min(8).max(30),
  cidade: z.string().trim().min(2).max(120),
  estado: z.string().trim().length(2).optional().or(z.literal("")),
  segmento: z.string().trim().min(2).max(120),
  volume_medio_compra: z.string().trim().max(120).optional().or(z.literal("")),
});

const termsSchema = z.object({
  priceTable: z.enum(["A", "B", "C"]),
  customerGroup: z.enum(["revendedor", "oficina", "distribuidor"]),
  allowedBoletoDays: z.array(z.union([
    z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(90), z.literal(120),
  ])).max(6),
  allowInvoice: z.boolean(),
  invoiceDueDays: z.number().int().min(1).max(120),
  maxCardInstallments: z.number().int().min(1).max(6),
});

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function validCnpj(value: unknown) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((acc, n, i) => acc + Number(n) * weights[i], 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = calc(cnpj.slice(0, 12) + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return cnpj === cnpj.slice(0, 12) + String(d1) + String(d2);
}

async function requireManager(userId: string, tenantId: string) {
  await requireTenantRole(supabaseAdmin as any, userId, tenantId, ["owner", "admin", "manager"]);
}

async function customerForUser(tenantId: string, userId: string) {
  const { data, error } = await (supabaseAdmin as any)
    .from("customers")
    .select("id,user_id,name,email,phone,document,customer_group,b2b_status,active")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as any | null;
}

async function ensureCustomerForRegistration(
  tenantId: string,
  userId: string,
  input: z.infer<typeof registrationSchema>,
  status: "pending" | "approved" = "pending",
  group: "b2b_pendente" | B2BCustomerGroup = "b2b_pendente",
) {
  const document = digits(input.cnpj);
  const [{ data: byUser, error: userError }, { data: byDocument, error: docError }] = await Promise.all([
    (supabaseAdmin as any).from("customers").select("id,user_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
    (supabaseAdmin as any).from("customers").select("id,user_id").eq("tenant_id", tenantId).eq("document", document).maybeSingle(),
  ]);
  if (userError) throw new Error(userError.message);
  if (docError) throw new Error(docError.message);
  if (byDocument?.user_id && byDocument.user_id !== userId) {
    throw new Error("Este CNPJ já está vinculado a outra conta.");
  }

  const targetId = byDocument?.id ?? byUser?.id ?? null;
  const payload = {
    tenant_id: tenantId,
    user_id: userId,
    name: input.razao_social,
    trade_name: input.nome_fantasia || null,
    phone: input.whatsapp,
    document,
    city: input.cidade,
    state: input.estado || null,
    customer_group: group,
    b2b_status: status,
    active: true,
    updated_at: new Date().toISOString(),
  };

  if (targetId) {
    if (byUser?.id && byDocument?.id && byUser.id !== byDocument.id) {
      await (supabaseAdmin as any).from("customers").update({ user_id: null }).eq("id", byUser.id).eq("tenant_id", tenantId);
    }
    const { data, error } = await (supabaseAdmin as any)
      .from("customers").update(payload).eq("id", targetId).eq("tenant_id", tenantId).select("id").single();
    if (error) throw new Error(error.message);
    return String(data.id);
  }

  const { data, error } = await (supabaseAdmin as any)
    .from("customers").insert(payload).select("id").single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export const submitB2BRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => registrationSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!validCnpj(data.cnpj)) throw new Error("Informe um CNPJ válido.");
    const cnpj = digits(data.cnpj);

    const { data: existing, error: existingError } = await (supabaseAdmin as any)
      .from("b2b_registrations")
      .select("id,status")
      .eq("tenant_id", context.tenantId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.status === "aprovado") {
      throw new Error("Seu cadastro B2B já está aprovado.");
    }

    const payload = {
      tenant_id: context.tenantId,
      user_id: context.userId,
      cnpj,
      razao_social: data.razao_social,
      nome_fantasia: data.nome_fantasia || null,
      whatsapp: data.whatsapp,
      cidade: data.cidade,
      estado: data.estado || null,
      segmento: data.segmento,
      volume_medio_compra: data.volume_medio_compra || null,
      status: "pendente",
      admin_notes: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error } = await (supabaseAdmin as any)
        .from("b2b_registrations").update(payload).eq("id", existing.id).eq("tenant_id", context.tenantId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await (supabaseAdmin as any).from("b2b_registrations").insert(payload);
      if (error) throw new Error(error.message);
    }

    await ensureCustomerForRegistration(context.tenantId, context.userId, data, "pending", "b2b_pendente");
    await (supabaseAdmin as any).from("profiles")
      .update({ customer_group: "b2b_pendente", b2b_status: "pending" })
      .eq("id", context.userId);

    return { ok: true, status: "pendente" as const };
  });

export const getMyB2BCommercialProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: customer, error: customerError }, { data: profile }, { data: registration }] = await Promise.all([
      (supabaseAdmin as any).from("customers")
        .select("id,customer_group,b2b_status")
        .eq("tenant_id", context.tenantId).eq("user_id", context.userId).eq("active", true).maybeSingle(),
      (supabaseAdmin as any).from("profiles")
        .select("customer_group,b2b_status").eq("id", context.userId).maybeSingle(),
      (supabaseAdmin as any).from("b2b_registrations")
        .select("status").eq("tenant_id", context.tenantId).eq("user_id", context.userId).maybeSingle(),
    ]);
    if (customerError) throw new Error(customerError.message);

    const group = String(customer?.customer_group ?? profile?.customer_group ?? "b2c");
    const status = String(customer?.b2b_status ?? profile?.b2b_status ?? "none");
    let approved = ["revendedor", "oficina", "distribuidor"].includes(group) && status === "approved";

    if (!approved) {
      const { data: membership } = await (supabaseAdmin as any).from("tenant_memberships")
        .select("role").eq("tenant_id", context.tenantId).eq("user_id", context.userId).eq("active", true).maybeSingle();
      approved = Boolean(membership && ["owner","admin","manager","sales"].includes(String(membership.role)));
    }

    let assignment: any = null;
    let settings: any = null;
    if (approved && customer?.id) {
      const [assignmentResult, settingsResult] = await Promise.all([
        (supabaseAdmin as any).from("b2b_customer_price_tables")
          .select("price_table,allowed_boleto_days,allow_invoice,invoice_due_days,max_card_installments,active")
          .eq("tenant_id", context.tenantId).eq("customer_id", customer.id).eq("active", true).maybeSingle(),
        (supabaseAdmin as any).from("b2b_price_table_settings")
          .select("table_a_discount_pct,table_b_discount_pct,table_c_discount_pct,active")
          .eq("tenant_id", context.tenantId).maybeSingle(),
      ]);
      if (assignmentResult.error) throw new Error(assignmentResult.error.message);
      if (settingsResult.error) throw new Error(settingsResult.error.message);
      assignment = assignmentResult.data;
      settings = settingsResult.data;
    }

    const priceTable = approved ? ((assignment?.price_table ?? "C") as B2BPriceTable) : null;
    const discountPct = !approved ? 0
      : priceTable === "A" ? Number(settings?.table_a_discount_pct ?? 8)
      : priceTable === "B" ? Number(settings?.table_b_discount_pct ?? 5)
      : Number(settings?.table_c_discount_pct ?? 0);

    return {
      approved,
      pending: status === "pending" || registration?.status === "pendente",
      rejected: status === "rejected" || registration?.status === "reprovado",
      customerGroup: (approved ? group : status === "pending" ? "b2b_pendente" : "b2c") as B2BCommercialProfile["customerGroup"],
      priceTable,
      discountPct,
      allowedBoletoDays: approved ? (assignment?.allowed_boleto_days ?? [15]) : [3],
      allowInvoice: approved ? Boolean(assignment?.allow_invoice ?? false) : false,
      invoiceDueDays: approved && assignment?.allow_invoice ? Number(assignment.invoice_due_days ?? 28) : null,
      maxCardInstallments: approved ? Number(assignment?.max_card_installments ?? 6) : 6,
      registrationStatus: (registration?.status ?? null) as B2BCommercialProfile["registrationStatus"],
    } satisfies B2BCommercialProfile;
  });

export const getMyB2BPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    productIds: z.array(z.string().uuid()).min(1).max(100),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const customer = await customerForUser(context.tenantId, context.userId);
    const approved = customer &&
      ["revendedor","oficina","distribuidor"].includes(String(customer.customer_group)) &&
      customer.b2b_status === "approved";
    if (!approved) return { table: null, prices: {} as Record<string, { effective: number; base: number }> };

    const [{ data: assignment, error: assignmentError }, { data: settings, error: settingsError }] = await Promise.all([
      (supabaseAdmin as any).from("b2b_customer_price_tables")
        .select("price_table,active").eq("tenant_id", context.tenantId)
        .eq("customer_id", customer.id).eq("active", true).maybeSingle(),
      (supabaseAdmin as any).from("b2b_price_table_settings")
        .select("table_a_discount_pct,table_b_discount_pct,table_c_discount_pct,active")
        .eq("tenant_id", context.tenantId).maybeSingle(),
    ]);
    if (assignmentError) throw new Error(assignmentError.message);
    if (settingsError) throw new Error(settingsError.message);

    const table = (assignment?.price_table ?? "C") as B2BPriceTable;
    const discount = table === "A" ? Number(settings?.table_a_discount_pct ?? 8)
      : table === "B" ? Number(settings?.table_b_discount_pct ?? 5)
      : Number(settings?.table_c_discount_pct ?? 0);

    const { data: products, error } = await (supabaseAdmin as any).from("products")
      .select("id,price_b2b,price_b2b_a,price_b2b_b,price_b2b_c,sale_price_b2c,price_b2c")
      .eq("tenant_id", context.tenantId).in("id", data.productIds)
      .eq("active", true).is("deleted_at", null);
    if (error) throw new Error(error.message);

    const prices: Record<string, { effective: number; base: number }> = {};
    for (const product of products ?? []) {
      const base = Number(product.price_b2b ?? product.sale_price_b2c ?? product.price_b2c ?? 0);
      const specific = table === "A" ? product.price_b2b_a : table === "B" ? product.price_b2b_b : product.price_b2b_c;
      const effective = specific == null
        ? Number((base * (1 - discount / 100)).toFixed(2))
        : Number(Number(specific).toFixed(2));
      if (base >= 0 && effective >= 0) prices[String(product.id)] = { base, effective };
    }
    return { table, prices };
  });

export const getB2BAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireManager(context.userId, context.tenantId);
    const [registrationsResult, customersResult, assignmentsResult] = await Promise.all([
      (supabaseAdmin as any).from("b2b_registrations")
        .select("id,user_id,cnpj,razao_social,nome_fantasia,whatsapp,cidade,estado,segmento,volume_medio_compra,status,admin_notes,reviewed_at,created_at")
        .eq("tenant_id", context.tenantId).order("created_at", { ascending: false }),
      (supabaseAdmin as any).from("customers")
        .select("id,user_id,name,trade_name,document,phone,email,customer_group,b2b_status,active")
        .eq("tenant_id", context.tenantId)
        .in("customer_group", ["b2b_pendente","revendedor","oficina","distribuidor"])
        .order("name"),
      (supabaseAdmin as any).from("b2b_customer_price_tables")
        .select("customer_id,price_table,allowed_boleto_days,allow_invoice,invoice_due_days,max_card_installments,active")
        .eq("tenant_id", context.tenantId),
    ]);
    const err = registrationsResult.error ?? customersResult.error ?? assignmentsResult.error;
    if (err) throw new Error(err.message);
    const terms = new Map((assignmentsResult.data ?? []).map((row: any) => [row.customer_id, row]));
    return {
      registrations: registrationsResult.data ?? [],
      customers: (customersResult.data ?? []).map((customer: any) => ({
        ...customer,
        commercial: terms.get(customer.id) ?? null,
      })),
    };
  });

export const reviewB2BRegistration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    registrationId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    adminNotes: z.string().trim().max(1000).optional(),
    terms: termsSchema.optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await requireManager(context.userId, context.tenantId);
    const { data: registration, error } = await (supabaseAdmin as any).from("b2b_registrations")
      .select("*").eq("tenant_id", context.tenantId).eq("id", data.registrationId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!registration) throw new Error("Solicitação B2B não encontrada.");

    if (data.decision === "reject") {
      const [registrationUpdate, profileUpdate, customerUpdate] = await Promise.all([
        (supabaseAdmin as any).from("b2b_registrations").update({
          status: "reprovado", admin_notes: data.adminNotes || null,
          reviewed_by: context.userId, reviewed_at: new Date().toISOString(),
        }).eq("id", registration.id).eq("tenant_id", context.tenantId),
        (supabaseAdmin as any).from("profiles")
          .update({ customer_group: "b2c", b2b_status: "rejected" }).eq("id", registration.user_id),
        (supabaseAdmin as any).from("customers")
          .update({ customer_group: "b2c", b2b_status: "rejected", updated_at: new Date().toISOString() })
          .eq("tenant_id", context.tenantId).eq("user_id", registration.user_id),
      ]);
      const firstError = registrationUpdate.error ?? profileUpdate.error ?? customerUpdate.error;
      if (firstError) throw new Error(firstError.message);

      const customer = await customerForUser(context.tenantId, registration.user_id);
      if (customer?.id) {
        const { error: disableError } = await (supabaseAdmin as any).from("b2b_customer_price_tables")
          .update({ active: false, updated_by: context.userId })
          .eq("tenant_id", context.tenantId).eq("customer_id", customer.id);
        if (disableError) throw new Error(disableError.message);
      }
      return { ok: true, status: "reprovado" as const };
    }

    const terms = termsSchema.parse(data.terms);
    const customerId = await ensureCustomerForRegistration(
      context.tenantId,
      registration.user_id,
      {
        cnpj: registration.cnpj,
        razao_social: registration.razao_social,
        nome_fantasia: registration.nome_fantasia ?? "",
        whatsapp: registration.whatsapp,
        cidade: registration.cidade,
        estado: registration.estado ?? "",
        segmento: registration.segmento,
        volume_medio_compra: registration.volume_medio_compra ?? "",
      },
      "approved",
      terms.customerGroup,
    );

    const cnpjDigits = digits(registration.cnpj);
    const [registrationUpdate, profileUpdate, assignmentUpdate] = await Promise.all([
      (supabaseAdmin as any).from("b2b_registrations").update({
        status: "aprovado", admin_notes: data.adminNotes || null,
        reviewed_by: context.userId, reviewed_at: new Date().toISOString(),
      }).eq("id", registration.id).eq("tenant_id", context.tenantId),
      (supabaseAdmin as any).from("profiles")
        .update({ customer_group: terms.customerGroup, b2b_status: "approved" }).eq("id", registration.user_id),
      (supabaseAdmin as any).from("b2b_customer_price_tables").upsert({
        tenant_id: context.tenantId,
        customer_id: customerId,
        cnpj_digits: cnpjDigits,
        price_table: terms.priceTable,
        allowed_boleto_days: [...new Set(terms.allowedBoletoDays)].sort((a,b) => a-b),
        allow_invoice: terms.allowInvoice,
        invoice_due_days: terms.invoiceDueDays,
        max_card_installments: terms.maxCardInstallments,
        active: true,
        created_by: context.userId,
        updated_by: context.userId,
      }, { onConflict: "tenant_id,customer_id" }),
    ]);
    const firstError = registrationUpdate.error ?? profileUpdate.error ?? assignmentUpdate.error;
    if (firstError) throw new Error(firstError.message);
    return { ok: true, status: "aprovado" as const, customerId };
  });

export const updateB2BCustomerTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    customerId: z.string().uuid(),
    terms: termsSchema,
  }).parse(input))
  .handler(async ({ data, context }) => {
    await requireManager(context.userId, context.tenantId);
    const { data: customer, error } = await (supabaseAdmin as any).from("customers")
      .select("id,user_id,document").eq("tenant_id", context.tenantId).eq("id", data.customerId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!customer) throw new Error("Cliente não encontrado.");
    const cnpj = digits(customer.document);
    if (!validCnpj(cnpj)) throw new Error("Cliente precisa ter CNPJ válido.");

    const { error: customerError } = await (supabaseAdmin as any).from("customers").update({
      customer_group: data.terms.customerGroup,
      b2b_status: "approved",
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", context.tenantId).eq("id", customer.id);
    if (customerError) throw new Error(customerError.message);

    if (customer.user_id) {
      await (supabaseAdmin as any).from("profiles")
        .update({ customer_group: data.terms.customerGroup, b2b_status: "approved" })
        .eq("id", customer.user_id);
    }

    const { error: termsError } = await (supabaseAdmin as any).from("b2b_customer_price_tables").upsert({
      tenant_id: context.tenantId,
      customer_id: customer.id,
      cnpj_digits: cnpj,
      price_table: data.terms.priceTable,
      allowed_boleto_days: [...new Set(data.terms.allowedBoletoDays)].sort((a,b) => a-b),
      allow_invoice: data.terms.allowInvoice,
      invoice_due_days: data.terms.invoiceDueDays,
      max_card_installments: data.terms.maxCardInstallments,
      active: true,
      updated_by: context.userId,
    }, { onConflict: "tenant_id,customer_id" });
    if (termsError) throw new Error(termsError.message);
    return { ok: true };
  });
