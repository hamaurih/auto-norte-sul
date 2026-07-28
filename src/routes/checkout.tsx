import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createStorefrontOrder } from "@/lib/order.functions";
import { useCart, cartStore } from "@/lib/cart-store";
import { useSession } from "@/lib/session";
import { brl } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/checkout")({
  head: () => ({ meta: [{ title: "Checkout · Norte Sul" }] }),
  component: Checkout,
});

const schema = z.object({
  customer_name: z.string().trim().min(3, "Informe o nome completo").max(120),
  customer_email: z.string().trim().email("Email inválido").max(255),
  customer_phone: z.string().trim().min(8, "Informe o telefone").max(30),
  customer_document: z.string().trim().min(11, "CPF/CNPJ inválido").max(20),
  shipping_zip: z.string().trim().min(8).max(10),
  shipping_street: z.string().trim().min(2).max(200),
  shipping_number: z.string().trim().min(1).max(20),
  shipping_complement: z.string().max(120).optional().or(z.literal("")),
  shipping_neighborhood: z.string().trim().min(2).max(120),
  shipping_city: z.string().trim().min(2).max(120),
  shipping_state: z.string().trim().length(2, "UF (2 letras)"),
  payment_method: z.enum(["pix", "cartao", "boleto", "faturado_b2b"]),
});

function Checkout() {
  const { items, subtotal } = useCart();
  const { user, loading, isB2BApproved } = useSession();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [form, setForm] = useState<z.infer<typeof schema>>({
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
  });

  useEffect(() => {
    if (user?.email) setForm((f) => ({ ...f, customer_email: user.email ?? "" }));
  }, [user?.email]);

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
      toast.error(parsed.error.issues[0]?.message ?? "Verifique os dados");
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
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
          items: items.map((item) => ({
            product_id: item.productId,
            quantity: item.quantity,
          })),
          paymentMethod: parsed.data.payment_method,
          idempotencyKey: idempotencyKey.current,
        },
      });
      if (!result.id) throw new Error("Pedido não retornado");
      idempotencyKey.current = crypto.randomUUID();

      cartStore.clear();
      toast.success("Pedido criado e estoque reservado.");
      navigate({ to: "/pedidos" });
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível concluir o pedido.");
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="container-x py-6">
      <h1 className="mb-4 font-display text-3xl font-bold uppercase">Checkout</h1>
      <form onSubmit={submit} className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">Dados do cliente</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome completo"><input required value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} className={input} /></Field>
              <Field label="Email"><input required type="email" value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} className={input} /></Field>
              <Field label="WhatsApp"><input required value={form.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} className={input} /></Field>
              <Field label="CPF ou CNPJ"><input required value={form.customer_document} onChange={(e) => set("customer_document", e.target.value)} className={input} /></Field>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">Endereço de entrega</legend>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-2"><Field label="CEP"><input required value={form.shipping_zip} onChange={(e) => set("shipping_zip", e.target.value)} className={input} /></Field></div>
              <div className="sm:col-span-4"><Field label="Rua"><input required value={form.shipping_street} onChange={(e) => set("shipping_street", e.target.value)} className={input} /></Field></div>
              <div className="sm:col-span-1"><Field label="Nº"><input required value={form.shipping_number} onChange={(e) => set("shipping_number", e.target.value)} className={input} /></Field></div>
              <div className="sm:col-span-3"><Field label="Complemento"><input value={form.shipping_complement ?? ""} onChange={(e) => set("shipping_complement", e.target.value)} className={input} /></Field></div>
              <div className="sm:col-span-2"><Field label="Bairro"><input required value={form.shipping_neighborhood} onChange={(e) => set("shipping_neighborhood", e.target.value)} className={input} /></Field></div>
              <div className="sm:col-span-4"><Field label="Cidade"><input required value={form.shipping_city} onChange={(e) => set("shipping_city", e.target.value)} className={input} /></Field></div>
              <div className="sm:col-span-2"><Field label="UF"><input required maxLength={2} value={form.shipping_state} onChange={(e) => set("shipping_state", e.target.value.toUpperCase())} className={input} /></Field></div>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-border bg-card p-4">
            <legend className="px-2 font-display text-sm font-bold uppercase">Pagamento</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { v: "pix", label: "PIX (5% OFF)" },
                { v: "cartao", label: "Cartão 10x sem juros" },
                { v: "boleto", label: "Boleto bancário" },
                ...(isB2BApproved ? [{ v: "faturado_b2b", label: "Faturado 28 dias (B2B)" }] : []),
              ].map((o) => (
                <label key={o.v} className={`cursor-pointer rounded-md border p-3 text-sm ${form.payment_method === o.v ? "border-primary bg-primary/5" : "border-border"}`}>
                  <input type="radio" name="pm" className="mr-2" checked={form.payment_method === o.v} onChange={() => set("payment_method", o.v as never)} />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

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
          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold">Total</span>
            <span className="price-tag text-2xl">{brl(subtotal)}</span>
          </div>
          <button disabled={saving} className="mt-4 w-full rounded-md bg-primary px-4 py-3 text-sm font-bold uppercase text-primary-foreground shadow-[var(--shadow-brand)] hover:brightness-110 disabled:opacity-50">
            {saving ? "Enviando…" : "Confirmar pedido"}
          </button>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Ao confirmar, o estoque será reservado até a confirmação do pagamento.
          </p>
        </aside>
      </form>
    </div>
  );
}

const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
