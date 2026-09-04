import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createStorefrontOrder } from "@/lib/order.functions";
import { createPaymentIntent } from "@/lib/payment.functions";
import { useCart, cartStore } from "@/lib/cart-store";
import { useSession } from "@/lib/session";
import { brl } from "@/lib/format";
import {
  maskDocument, validateDocument,
  maskCep, fetchAddressByCep,
  maskPhone,
} from "@/lib/format-input";
import { toast } from "sonner";

export const Route = createFileRoute("/checkout")({
  head: () => ({ meta: [{ title: "Checkout · Norte Sul" }] }),
  component: Checkout,
});

const PIX_DISCOUNT = 0.05; // 5%

const schema = z.object({
  customer_name:          z.string().trim().min(3, "Informe o nome completo").max(120),
  customer_email:         z.string().trim().email("Email inválido").max(255),
  customer_phone:         z.string().trim().min(8, "Informe o telefone").max(20),
  customer_document:      z.string().trim().min(11, "CPF ou CNPJ inválido").max(18),
  shipping_zip:           z.string().trim().min(8, "CEP inválido").max(10),
  shipping_street:        z.string().trim().min(2).max(200),
  shipping_number:        z.string().trim().min(1).max(20),
  shipping_complement:    z.string().max(120).optional().or(z.literal("")),
  shipping_neighborhood:  z.string().trim().min(2).max(120),
  shipping_city:          z.string().trim().min(2).max(120),
  shipping_state:         z.string().trim().length(2, "UF (2 letras)"),
  payment_method:         z.enum(["pix", "cartao", "faturado_b2b"]),
});

type FormData = z.infer<typeof schema>;

function Checkout() {
  const { items, subtotal } = useCart();
  const { user, loading, isB2BApproved } = useSession();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [fetchingCep, setFetchingCep] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const idempotencyKey = useRef(crypto.randomUUID());

  const [form, setForm] = useState<FormData>({
    customer_name:         "",
    customer_email:        "",
    customer_phone:        "",
    customer_document:     "",
    shipping_zip:          "",
    shipping_street:       "",
    shipping_number:       "",
    shipping_complement:   "",
    shipping_neighborhood: "",
    shipping_city:         "",
    shipping_state:        "",
    payment_method:        "pix",
  });

  useEffect(() => {
    if (user?.email) setForm((f) => ({ ...f, customer_email: user.email ?? "" }));
  }, [user?.email]);

  // UI-23: Calcula total com desconto PIX
  const pixDiscount  = form.payment_method === "pix" ? subtotal * PIX_DISCOUNT : 0;
  const total        = subtotal - pixDiscount;

  const set = <K extends keyof FormData>(k: K, v: FormData[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((e) => ({ ...e, [k]: undefined }));
  };

  // UI-21: Auto-preenchimento de endereço via CEP
  async function handleCepBlur() {
    const cep = form.shipping_zip.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setFetchingCep(true);
    const addr = await fetchAddressByCep(cep);
    setFetchingCep(false);
    if (addr) {
      setForm((f) => ({
        ...f,
        shipping_street:       addr.logradouro || f.shipping_street,
        shipping_neighborhood: addr.bairro      || f.shipping_neighborhood,
        shipping_city:         addr.localidade  || f.shipping_city,
        shipping_state:        addr.uf          || f.shipping_state,
      }));
    } else {
      toast.warning("CEP não encontrado — preencha o endereço manualmente.");
    }
  }

  if (!loading && !user) {
    return (
      <div className="container-x py-16 text-center">
        <h1 className="font-display text-2xl font-bold uppercase">Entre para finalizar a compra</h1>
        <Link to="/auth" search={{ next: "/checkout" } as never} className="mt-4 inline-block rounded-md bg-primary px-6 py-3 text-sm font-bold uppercase text-primary-foreground">
          Entrar / Cadastrar
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container-x py-16 text-center">
        <h1 className="font-display text-2xl font-bold uppercase">Carrinho vazio</h1>
        <Link to="/catalogo" className="mt-4 inline-block text-primary underline">Ver catálogo</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const errs: Partial<Record<keyof FormData, string>> = {};
      parsed.error.issues.forEach((i) => {
        const key = i.path[0] as keyof FormData;
        if (!errs[key]) errs[key] = i.message;
      });
      setFieldErrors(errs);
      toast.error("Corrija os campos destacados");
      return;
    }

    // UI-21: Valida CPF/CNPJ com dígito verificador
    const docVal = validateDocument(parsed.data.customer_document);
    if (!docVal.ok) {
      setFieldErrors((e) => ({ ...e, customer_document: "CPF ou CNPJ inválido" }));
      toast.error("Documento inválido");
      return;
    }

    if (!user) return;
    setSaving(true);
    try {
      const result = await createStorefrontOrder({
        data: {
          customer: {
            name:                  parsed.data.customer_name,
            email:                 parsed.data.customer_email,
            phone:                 parsed.data.customer_phone,
            document:              parsed.data.customer_document,
            shipping_zip:          parsed.data.shipping_zip,
            shipping_street:       parsed.data.shipping_street,
            shipping_number:       parsed.data.shipping_number,
            shipping_complement:   parsed.data.shipping_complement,
            shipping_neighborhood: parsed.data.shipping_neighborhood,
            shipping_city:         parsed.data.shipping_city,
            shipping_state:        parsed.data.shipping_state,
          },
          // DAT-08/DAT-17: Enviamos apenas product_id + quantity.
          // O servidor busca preços e valida estoque — nunca confiamos no frontend.
          items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
          paymentMethod: parsed.data.payment_method,
          idempotencyKey: idempotencyKey.current,
        },
      });
      if (!result.id) throw new Error("Pedido não retornado");

      idempotencyKey.current = crypto.randomUUID();
      cartStore.clear();

      if (parsed.data.payment_method === "pix" || parsed.data.payment_method === "cartao") {
        try {
          const payment = await createPaymentIntent({
            data: {
              orderId: result.id,
              idempotencyKey: crypto.randomUUID(),
              providerCode: "stone",
            },
          });
          if (payment.checkoutUrl) {
            toast.success("Pedido criado. Abrindo pagamento seguro Stone…");
            window.location.assign(payment.checkoutUrl);
            return;
          }
          throw new Error("A Stone não retornou o link de pagamento.");
        } catch (paymentError: any) {
          console.error(paymentError);
          toast.warning("Pedido criado e estoque reservado. O pagamento pode ser concluído em Meus Pedidos.", {
            description: paymentError?.message,
          });
          navigate({ to: "/pedidos" });
          return;
        }
      }

      toast.success("Pedido B2B criado e estoque reservado.");
      navigate({ to: "/pedidos" });
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "Não foi possível concluir o pedido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container-x py-6">
      <h1 className="mb-4 font-display text-3xl font-bold uppercase">Checkout</h1>
      <form onSubmit={submit} className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">

          {/* Dados do cliente */}
          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">Dados do cliente</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome completo" error={fieldErrors.customer_name}>
                <input required value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} className={inp(fieldErrors.customer_name)} />
              </Field>
              <Field label="Email" error={fieldErrors.customer_email}>
                <input required type="email" value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} className={inp(fieldErrors.customer_email)} />
              </Field>
              {/* UI-21: Máscaras de telefone e documento */}
              <Field label="WhatsApp" error={fieldErrors.customer_phone}>
                <input required value={form.customer_phone} inputMode="numeric"
                  onChange={(e) => set("customer_phone", maskPhone(e.target.value))}
                  placeholder="(00) 00000-0000" className={inp(fieldErrors.customer_phone)} />
              </Field>
              <Field label="CPF ou CNPJ" error={fieldErrors.customer_document}>
                <input required value={form.customer_document} inputMode="numeric"
                  onChange={(e) => set("customer_document", maskDocument(e.target.value))}
                  placeholder="000.000.000-00" className={inp(fieldErrors.customer_document)} />
              </Field>
            </div>
          </fieldset>

          {/* Endereço */}
          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">Endereço de entrega</legend>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-2">
                <Field label={fetchingCep ? "CEP (buscando…)" : "CEP"} error={fieldErrors.shipping_zip}>
                  <input required value={form.shipping_zip} inputMode="numeric"
                    onChange={(e) => set("shipping_zip", maskCep(e.target.value))}
                    onBlur={handleCepBlur}
                    placeholder="00000-000" className={inp(fieldErrors.shipping_zip)} />
                </Field>
              </div>
              <div className="sm:col-span-4">
                <Field label="Rua" error={fieldErrors.shipping_street}>
                  <input required value={form.shipping_street} onChange={(e) => set("shipping_street", e.target.value)} className={inp(fieldErrors.shipping_street)} />
                </Field>
              </div>
              <div className="sm:col-span-1">
                <Field label="Nº" error={fieldErrors.shipping_number}>
                  <input required value={form.shipping_number} onChange={(e) => set("shipping_number", e.target.value)} className={inp(fieldErrors.shipping_number)} />
                </Field>
              </div>
              <div className="sm:col-span-3">
                <Field label="Complemento">
                  <input value={form.shipping_complement ?? ""} onChange={(e) => set("shipping_complement", e.target.value)} className={inp()} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Bairro" error={fieldErrors.shipping_neighborhood}>
                  <input required value={form.shipping_neighborhood} onChange={(e) => set("shipping_neighborhood", e.target.value)} className={inp(fieldErrors.shipping_neighborhood)} />
                </Field>
              </div>
              <div className="sm:col-span-4">
                <Field label="Cidade" error={fieldErrors.shipping_city}>
                  <input required value={form.shipping_city} onChange={(e) => set("shipping_city", e.target.value)} className={inp(fieldErrors.shipping_city)} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="UF" error={fieldErrors.shipping_state}>
                  <input required maxLength={2} value={form.shipping_state}
                    onChange={(e) => set("shipping_state", e.target.value.toUpperCase())}
                    placeholder="SP" className={inp(fieldErrors.shipping_state)} />
                </Field>
              </div>
            </div>
          </fieldset>

          {/* Pagamento */}
          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">Pagamento</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { v: "pix",          label: `PIX Stone — 5% de desconto (${brl(pixDiscount > 0 ? pixDiscount : subtotal * PIX_DISCOUNT)})` },
                { v: "cartao",       label: "Cartão Stone — até 10×" },
                ...(isB2BApproved ? [{ v: "faturado_b2b", label: "Faturado 28 dias (B2B)" }] : []),
              ].map((o) => (
                <label key={o.v} className={`cursor-pointer rounded-md border p-3 text-sm ${form.payment_method === o.v ? "border-primary bg-primary/5" : "border-border"}`}>
                  <input type="radio" name="pm" className="mr-2" checked={form.payment_method === o.v} onChange={() => set("payment_method", o.v as FormData["payment_method"])} />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Resumo */}
        <aside className="h-fit rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 font-display text-lg font-bold uppercase">Seu pedido</h3>
          <ul className="mb-3 space-y-1 text-xs">
            {items.map((i) => (
              <li key={i.productId} className="flex justify-between gap-2">
                <span className="line-clamp-1">{i.quantity}× {i.name}</span>
                <span>{brl(i.unitPrice * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-border pt-3">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span><span>{brl(subtotal)}</span>
            </div>
            {/* UI-23: Desconto PIX aplicado no total */}
            {form.payment_method === "pix" && (
              <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                <span>Desconto PIX (5%)</span>
                <span>− {brl(pixDiscount)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-2 mt-2">
              <span className="text-sm font-semibold">Total</span>
              <span className="price-tag text-2xl">{brl(total)}</span>
            </div>
          </div>
          <button disabled={saving} className="mt-4 w-full rounded-md bg-primary px-4 py-3 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110 disabled:opacity-50">
            {saving ? "Verificando e enviando…" : "Confirmar pedido"}
          </button>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Preços e estoque são confirmados no servidor antes do pedido.
          </p>
        </aside>
      </form>
    </div>
  );
}

const inp = (err?: string) =>
  `w-full rounded-md border px-3 py-2 text-sm outline-none bg-background ${err ? "border-destructive focus:border-destructive" : "border-border focus:border-primary"}`;

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  );
}