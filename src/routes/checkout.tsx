import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import {
  createStorefrontOrder,
  listStorefrontPickupLocations,
  type FulfillmentType,
  type PickupLocation,
} from "@/lib/order.functions";
import { createPaymentIntent } from "@/lib/payment.functions";
import { useCart, cartStore } from "@/lib/cart-store";
import { useSession } from "@/lib/session";
import { brl } from "@/lib/format";
import {
  maskDocument,
  validateDocument,
  maskCep,
  fetchAddressByCep,
  maskPhone,
} from "@/lib/format-input";
import { Clock3, MapPin, Store, Truck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/checkout")({
  validateSearch: z.object({ pedido: z.string().uuid().optional() }),
  head: () => ({ meta: [{ title: "Checkout · Norte Sul" }] }),
  component: Checkout,
});

const PIX_DISCOUNT = 0.05;

const schema = z.object({
  customer_name: z.string().trim().min(3, "Informe o nome completo").max(120),
  customer_email: z.string().trim().email("Email inválido").max(255),
  customer_phone: z.string().trim().refine((v) => /^\d{10,11}$/.test(v.replace(/\D/g, "")), "Informe um telefone com DDD"),
  customer_document: z.string().trim().min(11, "CPF ou CNPJ inválido").max(18),
  shipping_zip: z.string().trim().refine((v) => /^\d{8}$/.test(v.replace(/\D/g, "")), "CEP inválido"),
  shipping_street: z.string().trim().min(2).max(200),
  shipping_number: z.string().trim().min(1).max(20),
  shipping_complement: z.string().max(120).optional().or(z.literal("")),
  shipping_neighborhood: z.string().trim().min(2).max(120),
  shipping_city: z.string().trim().min(2).max(120),
  shipping_state: z.string().trim().length(2, "UF (2 letras)"),
  payment_method: z.enum(["pix", "cartao", "boleto", "faturado_b2b"]),
  boleto_due_days: z.union([
    z.literal(3),
    z.literal(15),
    z.literal(30),
    z.literal(45),
    z.literal(60),
    z.literal(90),
    z.literal(120),
  ]),
});

type FormData = z.infer<typeof schema>;
type CardForm = {
  holderName: string;
  number: string;
  expiry: string;
  ccv: string;
  installments: 1 | 2 | 3 | 4 | 5 | 6;
};
type PaymentView = {
  method: "pix" | "boleto" | "cartao";
  pixCopyPaste?: string | null;
  pixQrCodeUrl?: string | null;
  boletoUrl?: string | null;
  boletoBarcode?: string | null;
  status: string;
};

function Checkout() {
  const { items, subtotal } = useCart();
  const { user, loading, isB2BApproved } = useSession();
  const navigate = useNavigate();
  const { pedido: resumeOrderId } = Route.useSearch();
  const listPickupLocations = useServerFn(listStorefrontPickupLocations);

  const [saving, setSaving] = useState(false);
  const [fetchingCep, setFetchingCep] = useState(false);
  const [paymentView, setPaymentView] = useState<PaymentView | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(resumeOrderId ?? null);
  const [resumeTotal, setResumeTotal] = useState<number | null>(null);
  const [resumeLoading, setResumeLoading] = useState(Boolean(resumeOrderId));
  const [card, setCard] = useState<CardForm>({
    holderName: "",
    number: "",
    expiry: "",
    ccv: "",
    installments: 1,
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("delivery");
  const [pickupBranchId, setPickupBranchId] = useState("");
  const [pickupLocations, setPickupLocations] = useState<PickupLocation[]>([]);
  const [pickupLoading, setPickupLoading] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const [form, setForm] = useState<FormData>({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    customer_document: "",
    shipping_zip: "",
    shipping_street: "",
    shipping_number: "",
    shipping_complement: "",
    shipping_neighborhood: "",
    shipping_city: "",
    shipping_state: "",
    payment_method: "pix",
    boleto_due_days: 15,
  });

  useEffect(() => {
    if (!user) return;
    let active = true;
    setPickupLoading(true);
    void listPickupLocations()
      .then((locations) => {
        if (!active) return;
        const rows = (locations ?? []) as PickupLocation[];
        setPickupLocations(rows);
        setPickupBranchId((current) => current || rows[0]?.id || "");
      })
      .catch((error: Error) => {
        if (!active) return;
        console.error(error);
        setPickupLocations([]);
      })
      .finally(() => {
        if (active) setPickupLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, listPickupLocations]);

  useEffect(() => {
    if (!user) return;
    void (supabase as any)
      .from("orders")
      .select("customer_name,customer_email,customer_phone,customer_document,shipping_zip,shipping_street,shipping_number,shipping_complement,shipping_neighborhood,shipping_city,shipping_state")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        setForm((current) => ({
          ...current,
          customer_name: current.customer_name || data?.customer_name || String(user.user_metadata?.full_name ?? ""),
          customer_email: current.customer_email || data?.customer_email || user.email || "",
          customer_phone: current.customer_phone || data?.customer_phone || String(user.user_metadata?.phone ?? ""),
          customer_document: current.customer_document || data?.customer_document || "",
          shipping_zip: current.shipping_zip || data?.shipping_zip || "",
          shipping_street: current.shipping_street || data?.shipping_street || "",
          shipping_number: current.shipping_number || data?.shipping_number || "",
          shipping_complement: current.shipping_complement || data?.shipping_complement || "",
          shipping_neighborhood: current.shipping_neighborhood || data?.shipping_neighborhood || "",
          shipping_city: current.shipping_city || data?.shipping_city || "",
          shipping_state: current.shipping_state || data?.shipping_state || "",
        }));
      });
  }, [user]);

  useEffect(() => {
    if (!resumeOrderId || !user) return;
    let active = true;
    setResumeLoading(true);
    void (supabase as any)
      .from("orders")
      .select("id,status,total,payment_method,customer_name,customer_email,customer_phone,customer_document,shipping_zip,shipping_street,shipping_number,shipping_complement,shipping_neighborhood,shipping_city,shipping_state,fulfillment_type,pickup_branch_id")
      .eq("id", resumeOrderId)
      .maybeSingle()
      .then(({ data, error }: { data: any; error: any }) => {
        if (!active) return;
        if (error || !data || data.status !== "aguardando_pagamento") {
          setPaymentError("Este pedido não está disponível para pagamento.");
          return;
        }
        const paymentMethod = String(data.payment_method);
        if (!["pix", "cartao", "boleto"].includes(paymentMethod)) {
          setPaymentError("A forma de pagamento deste pedido não pode ser retomada online.");
          return;
        }
        setPendingOrderId(data.id);
        setResumeTotal(Number(data.total));
        setFulfillmentType(data.fulfillment_type === "pickup" ? "pickup" : "delivery");
        setPickupBranchId(data.pickup_branch_id ?? "");
        setForm((current) => ({
          ...current,
          customer_name: data.customer_name ?? "",
          customer_email: data.customer_email ?? current.customer_email,
          customer_phone: data.customer_phone ?? "",
          customer_document: data.customer_document ?? "",
          shipping_zip: data.shipping_zip ?? "",
          shipping_street: data.shipping_street ?? "",
          shipping_number: data.shipping_number ?? "",
          shipping_complement: data.shipping_complement ?? "",
          shipping_neighborhood: data.shipping_neighborhood ?? "",
          shipping_city: data.shipping_city ?? "",
          shipping_state: data.shipping_state ?? "",
          payment_method: paymentMethod as FormData["payment_method"],
        }));
      })
      .finally(() => {
        if (active) setResumeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resumeOrderId, user]);

  const selectedPickup = pickupLocations.find((location) => location.id === pickupBranchId) ?? null;
  const pixDiscount = form.payment_method === "pix" ? subtotal * PIX_DISCOUNT : 0;
  const total = resumeTotal ?? subtotal - pixDiscount;

  const updateCard = <K extends keyof CardForm>(key: K, value: CardForm[K]) =>
    setCard((current) => ({ ...current, [key]: value }));
  const maskCard = (value: string) =>
    value.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
  const maskExpiry = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  };

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  async function handleCepBlur() {
    const cep = form.shipping_zip.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setFetchingCep(true);
    const addr = await fetchAddressByCep(cep);
    setFetchingCep(false);
    if (addr) {
      setForm((current) => ({
        ...current,
        shipping_street: addr.logradouro || current.shipping_street,
        shipping_neighborhood: addr.bairro || current.shipping_neighborhood,
        shipping_city: addr.localidade || current.shipping_city,
        shipping_state: addr.uf || current.shipping_state,
      }));
    } else {
      toast.warning("CEP não encontrado — preencha o endereço manualmente.");
    }
  }

  if (!loading && !user) {
    return (
      <div className="container-x py-16 text-center">
        <h1 className="font-display text-2xl font-bold uppercase">Entre para finalizar a compra</h1>
        <Link
          to="/auth"
          search={{ next: "/checkout" } as never}
          className="mt-4 inline-block rounded-md bg-primary px-6 py-3 text-sm font-bold uppercase text-primary-foreground"
        >
          Entrar / Cadastrar
        </Link>
      </div>
    );
  }

  if (!resumeOrderId && items.length === 0) {
    return (
      <div className="container-x py-16 text-center">
        <h1 className="font-display text-2xl font-bold uppercase">Carrinho vazio</h1>
        <Link to="/catalogo" className="mt-4 inline-block text-primary underline">
          Ver catálogo
        </Link>
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const errors: Partial<Record<keyof FormData, string>> = {};
      parsed.error.issues.forEach((issue) => {
        const key = issue.path[0] as keyof FormData;
        if (!errors[key]) errors[key] = issue.message;
      });
      setFieldErrors(errors);
      toast.error("Corrija os campos destacados");
      return;
    }

    if (fulfillmentType === "pickup" && !pickupBranchId) {
      toast.error("Selecione a loja para retirada.");
      return;
    }

    const docVal = validateDocument(parsed.data.customer_document);
    if (!docVal.ok) {
      setFieldErrors((current) => ({ ...current, customer_document: "CPF ou CNPJ inválido" }));
      toast.error("Documento inválido");
      return;
    }
    if (total < 5 && parsed.data.payment_method !== "faturado_b2b") {
      toast.error("O valor mínimo para pagamento é R$ 5,00.");
      return;
    }
    const [expiryMonth = "", expiryYear = ""] = card.expiry.split("/");
    if (
      parsed.data.payment_method === "cartao" &&
      (!card.holderName.trim() ||
        card.number.replace(/\D/g, "").length < 13 ||
        expiryMonth.length !== 2 ||
        expiryYear.length !== 2 ||
        card.ccv.replace(/\D/g, "").length < 3)
    ) {
      toast.error("Preencha todos os dados do cartão.");
      return;
    }

    if (!user) return;
    setSaving(true);
    setPaymentError(null);
    try {
      let orderId = pendingOrderId;
      if (!orderId) {
        const result = await createStorefrontOrder({
          data: {
            customer: {
              name: parsed.data.customer_name,
              email: parsed.data.customer_email,
              phone: parsed.data.customer_phone,
              document: parsed.data.customer_document,
              shipping_zip: parsed.data.shipping_zip,
              shipping_street: parsed.data.shipping_street,
              shipping_number: parsed.data.shipping_number,
              shipping_complement: parsed.data.shipping_complement,
              shipping_neighborhood: parsed.data.shipping_neighborhood,
              shipping_city: parsed.data.shipping_city,
              shipping_state: parsed.data.shipping_state,
            },
            items: items.map((item) => ({ product_id: item.productId, quantity: item.quantity })),
            paymentMethod: parsed.data.payment_method,
            boletoDueDays:
              parsed.data.payment_method === "boleto" ? parsed.data.boleto_due_days : undefined,
            idempotencyKey: idempotencyKey.current,
            fulfillmentType,
            pickupBranchId: fulfillmentType === "pickup" ? pickupBranchId : undefined,
          },
        });
        if (!result.id) throw new Error("Pedido não retornado");
        orderId = result.id;
        setPendingOrderId(orderId);
        idempotencyKey.current = crypto.randomUUID();
      }

      if (["pix", "cartao", "boleto"].includes(parsed.data.payment_method)) {
        try {
          const payment = await createPaymentIntent({
            data: {
              orderId,
              idempotencyKey: crypto.randomUUID(),
              providerCode: "asaas",
              boletoDueDays:
                parsed.data.payment_method === "boleto" ? parsed.data.boleto_due_days : undefined,
              installments: parsed.data.payment_method === "cartao" ? card.installments : 1,
              card:
                parsed.data.payment_method === "cartao"
                  ? {
                      holderName: card.holderName,
                      number: card.number,
                      expiryMonth,
                      expiryYear,
                      ccv: card.ccv,
                    }
                  : undefined,
            },
          });
          if (parsed.data.payment_method === "cartao") {
            if (payment.status === "paid") {
              cartStore.clear();
              toast.success(
                fulfillmentType === "pickup"
                  ? "Pagamento aprovado. Vamos preparar seu pedido para retirada."
                  : "Pagamento aprovado. Estamos confirmando seu pedido.",
              );
              navigate({ to: "/pedidos" });
              return;
            }
            setPaymentView({ method: "cartao", status: payment.status });
            setPaymentError(
              "O cartão ainda está sendo confirmado. Confira os dados ou aguarde a análise; você continuará nesta tela.",
            );
            return;
          }
          if (
            parsed.data.payment_method === "pix" &&
            (!payment.pixQrCodeUrl || !payment.pixCopyPaste)
          ) {
            throw new Error(
              "A cobrança PIX foi criada, mas o QR Code ainda não está disponível. Tente novamente nesta tela.",
            );
          }
          if (parsed.data.payment_method === "boleto") {
            cartStore.clear();
            window.location.assign(`/pagamento?pedido=${encodeURIComponent(orderId)}`);
            return;
          }
          cartStore.clear();
          setPaymentView({
            method: parsed.data.payment_method,
            pixCopyPaste: payment.pixCopyPaste,
            pixQrCodeUrl: payment.pixQrCodeUrl,
            boletoUrl: payment.boletoUrl,
            boletoBarcode: payment.boletoBarcode,
            status: payment.status,
          });
          return;
        } catch (paymentIssue: any) {
          console.error(paymentIssue);
          const message = paymentIssue?.message ?? "Não foi possível gerar a cobrança agora.";
          setPaymentError(message);
          toast.error(message);
          return;
        }
      }

      toast.success(
        fulfillmentType === "pickup"
          ? "Pedido B2B criado. Avisaremos quando estiver pronto para retirada."
          : "Pedido B2B criado e estoque reservado.",
      );
      navigate({ to: "/pedidos" });
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message ?? "Não foi possível concluir o pedido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container-x py-6">
      <h1 className="mb-4 font-display text-3xl font-bold uppercase">Checkout</h1>
      {resumeLoading && (
        <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm">
          Carregando o pedido para pagamento…
        </div>
      )}
      {paymentError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <b>Pagamento ainda não foi concluído.</b> {paymentError} Revise os dados e tente novamente nesta tela.
        </div>
      )}
      <form onSubmit={submit} className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">Dados do cliente</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome completo" error={fieldErrors.customer_name}>
                <input
                  required
                  value={form.customer_name}
                  onChange={(event) => set("customer_name", event.target.value)}
                  className={inp(fieldErrors.customer_name)}
                />
              </Field>
              <Field label="Email" error={fieldErrors.customer_email}>
                <input
                  required
                  type="email"
                  value={form.customer_email}
                  onChange={(event) => set("customer_email", event.target.value)}
                  className={inp(fieldErrors.customer_email)}
                />
              </Field>
              <Field label="WhatsApp" error={fieldErrors.customer_phone}>
                <input
                  required
                  value={form.customer_phone}
                  inputMode="numeric"
                  onChange={(event) => set("customer_phone", maskPhone(event.target.value))}
                  placeholder="(00) 00000-0000"
                  className={inp(fieldErrors.customer_phone)}
                />
              </Field>
              <Field label="CPF ou CNPJ" error={fieldErrors.customer_document}>
                <input
                  required
                  value={form.customer_document}
                  inputMode="numeric"
                  onChange={(event) => set("customer_document", maskDocument(event.target.value))}
                  placeholder="000.000.000-00"
                  className={inp(fieldErrors.customer_document)}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">Como você quer receber?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label
                className={`cursor-pointer rounded-xl border p-4 transition ${
                  fulfillmentType === "delivery"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50"
                } ${pendingOrderId ? "cursor-not-allowed opacity-80" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="fulfillment"
                    className="mt-1"
                    checked={fulfillmentType === "delivery"}
                    disabled={Boolean(pendingOrderId)}
                    onChange={() => setFulfillmentType("delivery")}
                  />
                  <Truck className="mt-0.5 h-5 w-5 text-primary" />
                  <div>
                    <div className="font-bold">Receber no endereço</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Seu pedido segue pelo fluxo de entrega e expedição.
                    </div>
                  </div>
                </div>
              </label>

              <label
                className={`rounded-xl border p-4 transition ${
                  fulfillmentType === "pickup"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border"
                } ${pickupLocations.length > 0 && !pendingOrderId ? "cursor-pointer hover:border-primary/50" : "cursor-not-allowed opacity-70"}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="fulfillment"
                    className="mt-1"
                    checked={fulfillmentType === "pickup"}
                    disabled={Boolean(pendingOrderId) || pickupLoading || pickupLocations.length === 0}
                    onChange={() => setFulfillmentType("pickup")}
                  />
                  <Store className="mt-0.5 h-5 w-5 text-primary" />
                  <div>
                    <div className="font-bold">Retirar na loja</div>
                    <div className="mt-1 text-xs font-semibold text-emerald-600">Grátis — sem frete</div>
                    {pickupLocations.length === 0 && !pickupLoading && (
                      <div className="mt-1 text-xs text-muted-foreground">Nenhuma loja disponível no momento.</div>
                    )}
                  </div>
                </div>
              </label>
            </div>

            {fulfillmentType === "pickup" && pickupLocations.length > 0 && (
              <div className="mt-4 space-y-3">
                {pickupLocations.length > 1 && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
                      Loja para retirada
                    </span>
                    <select
                      value={pickupBranchId}
                      disabled={Boolean(pendingOrderId)}
                      onChange={(event) => setPickupBranchId(event.target.value)}
                      className={inp()}
                    >
                      {pickupLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name} — {location.city}/{location.state}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {selectedPickup && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm">
                    <div className="flex items-center gap-2 font-bold text-emerald-900">
                      <MapPin className="h-4 w-4" /> {selectedPickup.name}
                    </div>
                    <p className="mt-2 text-emerald-900">
                      {selectedPickup.address}
                      {selectedPickup.city ? ` · ${selectedPickup.city}` : ""}
                      {selectedPickup.state ? `/${selectedPickup.state}` : ""}
                    </p>
                    {selectedPickup.business_hours && (
                      <p className="mt-2 flex items-center gap-2 text-xs text-emerald-800">
                        <Clock3 className="h-3.5 w-3.5" /> Horário: {selectedPickup.business_hours}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-emerald-800">
                      {selectedPickup.pickup_instructions ||
                        "Aguarde a confirmação de que o pedido está pronto antes de ir à loja."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">
              {fulfillmentType === "pickup" ? "Endereço do cliente / cobrança" : "Endereço de entrega"}
            </legend>
            {fulfillmentType === "pickup" && (
              <p className="mb-4 text-xs text-muted-foreground">
                A retirada será na loja indicada acima. Seu endereço continua necessário para cadastro, faturamento e processamento do pagamento.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-2">
                <Field label={fetchingCep ? "CEP (buscando…)" : "CEP"} error={fieldErrors.shipping_zip}>
                  <input
                    required
                    value={form.shipping_zip}
                    inputMode="numeric"
                    onChange={(event) => set("shipping_zip", maskCep(event.target.value))}
                    onBlur={handleCepBlur}
                    placeholder="00000-000"
                    className={inp(fieldErrors.shipping_zip)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-4">
                <Field label="Rua" error={fieldErrors.shipping_street}>
                  <input
                    required
                    value={form.shipping_street}
                    onChange={(event) => set("shipping_street", event.target.value)}
                    className={inp(fieldErrors.shipping_street)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="Nº" error={fieldErrors.shipping_number}>
                  <input
                    required
                    value={form.shipping_number}
                    onChange={(event) => set("shipping_number", event.target.value)}
                    className={inp(fieldErrors.shipping_number)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-3">
                <Field label="Complemento">
                  <input
                    value={form.shipping_complement ?? ""}
                    onChange={(event) => set("shipping_complement", event.target.value)}
                    className={inp()}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Bairro" error={fieldErrors.shipping_neighborhood}>
                  <input
                    required
                    value={form.shipping_neighborhood}
                    onChange={(event) => set("shipping_neighborhood", event.target.value)}
                    className={inp(fieldErrors.shipping_neighborhood)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-4">
                <Field label="Cidade" error={fieldErrors.shipping_city}>
                  <input
                    required
                    value={form.shipping_city}
                    onChange={(event) => set("shipping_city", event.target.value)}
                    className={inp(fieldErrors.shipping_city)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="UF" error={fieldErrors.shipping_state}>
                  <input
                    required
                    maxLength={2}
                    value={form.shipping_state}
                    onChange={(event) => set("shipping_state", event.target.value.toUpperCase())}
                    placeholder="PB"
                    className={inp(fieldErrors.shipping_state)}
                  />
                </Field>
              </div>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">Pagamento</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                {
                  v: "pix",
                  label: `PIX — 5% de desconto (${brl(
                    pixDiscount > 0 ? pixDiscount : subtotal * PIX_DISCOUNT,
                  )})`,
                },
                { v: "cartao", label: "Cartão — até 6× sem juros" },
                {
                  v: "boleto",
                  label: isB2BApproved
                    ? "Boleto para CPF ou CNPJ"
                    : "Boleto — vencimento em até 3 dias",
                },
                ...(isB2BApproved
                  ? [{ v: "faturado_b2b", label: "Faturado 28 dias (B2B)" }]
                  : []),
              ].map((option) => (
                <label
                  key={option.v}
                  className={`cursor-pointer rounded-md border p-3 text-sm ${
                    form.payment_method === option.v ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="pm"
                    className="mr-2"
                    checked={form.payment_method === option.v}
                    onChange={() => {
                      set("payment_method", option.v as FormData["payment_method"]);
                      if (option.v === "boleto" && !isB2BApproved) set("boleto_due_days", 3);
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>

            {form.payment_method === "boleto" && (
              <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
                <label className="block text-xs font-bold uppercase text-muted-foreground">
                  {isB2BApproved ? "Prazo de vencimento negociado" : "Prazo de vencimento"}
                </label>
                <select
                  value={form.boleto_due_days}
                  onChange={(event) =>
                    set(
                      "boleto_due_days",
                      Number(event.target.value) as FormData["boleto_due_days"],
                    )
                  }
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {(isB2BApproved ? [15, 30, 45, 60, 90, 120] : [3]).map((days) => (
                    <option key={days} value={days}>
                      {days} dias{days === 120 ? " — grande negociação" : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-muted-foreground">
                  {isB2BApproved
                    ? "Cliente B2B aprovado: escolha o prazo negociado com CPF ou CNPJ."
                    : "Cliente B2C: boleto com vencimento em até 3 dias, mediante CPF ou CNPJ válido."}
                </p>
              </div>
            )}

            {form.payment_method === "cartao" && (
              <div className="mt-3 grid gap-3 rounded-md border border-primary/20 bg-primary/5 p-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="Nome impresso no cartão">
                    <input
                      required
                      value={card.holderName}
                      autoComplete="cc-name"
                      onChange={(event) => updateCard("holderName", event.target.value)}
                      className={inp()}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Número do cartão">
                    <input
                      required
                      value={card.number}
                      inputMode="numeric"
                      autoComplete="cc-number"
                      onChange={(event) => updateCard("number", maskCard(event.target.value))}
                      placeholder="0000 0000 0000 0000"
                      className={inp()}
                    />
                  </Field>
                </div>
                <Field label="Validade">
                  <input
                    required
                    value={card.expiry}
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    onChange={(event) => updateCard("expiry", maskExpiry(event.target.value))}
                    placeholder="MM/AA"
                    className={inp()}
                  />
                </Field>
                <Field label="CVV">
                  <input
                    required
                    value={card.ccv}
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    onChange={(event) =>
                      updateCard("ccv", event.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    placeholder="000"
                    className={inp()}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Parcelamento">
                    <select
                      value={card.installments}
                      onChange={(event) =>
                        updateCard(
                          "installments",
                          Number(event.target.value) as CardForm["installments"],
                        )
                      }
                      className={inp()}
                    >
                      {[1, 2, 3, 4, 5, 6].map((count) => (
                        <option key={count} value={count}>
                          {count}× de {brl(total / count)} sem juros
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <p className="sm:col-span-2 text-xs text-muted-foreground">
                  Pagamento processado em ambiente seguro. Os dados do cartão não são armazenados pela Norte Sul.
                </p>
              </div>
            )}
          </fieldset>
        </div>

        <aside className="h-fit rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 font-display text-lg font-bold uppercase">Seu pedido</h3>
          <ul className="mb-3 space-y-1 text-xs">
            {items.map((item) => (
              <li key={item.productId} className="flex justify-between gap-2">
                <span className="line-clamp-1">
                  {item.quantity}× {item.name}
                </span>
                <span>{brl(item.unitPrice * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-border pt-3">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>{brl(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>{fulfillmentType === "pickup" ? "Retirada na loja" : "Entrega"}</span>
              <span className={fulfillmentType === "pickup" ? "font-semibold text-emerald-600" : ""}>
                {fulfillmentType === "pickup" ? "Grátis" : "Calculado no pedido"}
              </span>
            </div>
            {form.payment_method === "pix" && (
              <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                <span>Desconto PIX (5%)</span>
                <span>− {brl(pixDiscount)}</span>
              </div>
            )}
            <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
              <span className="text-sm font-semibold">Total</span>
              <span className="price-tag text-2xl">{brl(total)}</span>
            </div>
          </div>
          <button
            disabled={saving || (fulfillmentType === "pickup" && !pickupBranchId)}
            className="mt-4 w-full rounded-md bg-primary px-4 py-3 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110 disabled:opacity-50"
          >
            {saving
              ? "Preparando pagamento…"
              : pendingOrderId
                ? "Tentar pagamento novamente"
                : "Confirmar pedido"}
          </button>
          {saving && (
            <p className="mt-2 text-center text-xs font-medium text-primary">
              Aguarde nesta página: o QR Code ou a resposta do cartão aparecerá aqui.
            </p>
          )}
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Preços e estoque são confirmados no servidor antes do pedido.
          </p>
        </aside>
      </form>
      {paymentView && (
        <PaymentPanel payment={paymentView} onClose={() => navigate({ to: "/pedidos" })} />
      )}
    </div>
  );
}

function PaymentPanel({ payment, onClose }: { payment: PaymentView; onClose: () => void }) {
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success("Código copiado.");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <section
        className="w-full max-w-md rounded-xl bg-background p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        {payment.method === "pix" ? (
          <>
            <h2 className="font-display text-2xl font-bold uppercase">Pague com PIX</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Aponte a câmera para o QR Code ou use o código de copia e cola.
            </p>
            {payment.pixQrCodeUrl && (
              <img
                src={payment.pixQrCodeUrl}
                alt="QR Code PIX"
                className="mx-auto my-5 h-52 w-52 rounded-md"
              />
            )}
            {payment.pixCopyPaste && (
              <button
                type="button"
                onClick={() => copy(payment.pixCopyPaste!)}
                className="w-full rounded-md bg-primary px-4 py-3 text-sm font-bold text-primary-foreground"
              >
                Copiar código PIX
              </button>
            )}
          </>
        ) : payment.method === "cartao" ? (
          <>
            <h2 className="font-display text-2xl font-bold uppercase">Processando cartão</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A resposta do cartão ainda está sendo confirmada. Você permanecerá nesta página e não será enviado ao catálogo.
            </p>
          </>
        ) : (
          <>
            <h2 className="font-display text-2xl font-bold uppercase">Boleto gerado</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Use a linha digitável ou abra o boleto para pagamento.
            </p>
            {payment.boletoBarcode && (
              <button
                type="button"
                onClick={() => copy(payment.boletoBarcode!)}
                className="mt-4 w-full rounded-md bg-primary px-4 py-3 text-sm font-bold text-primary-foreground"
              >
                Copiar código de barras
              </button>
            )}
            {payment.boletoUrl && (
              <a
                href={payment.boletoUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block w-full rounded-md border border-primary px-4 py-3 text-center text-sm font-bold text-primary"
              >
                Abrir boleto
              </a>
            )}
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-md border border-border px-4 py-3 text-sm font-bold"
        >
          Ver meus pedidos
        </button>
      </section>
    </div>
  );
}

const inp = (error?: string) =>
  `w-full rounded-md border px-3 py-2 text-sm outline-none bg-background ${
    error ? "border-destructive focus:border-destructive" : "border-border focus:border-primary"
  }`;

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  );
}