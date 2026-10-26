import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Check, Plus, Settings2, Users, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createOfflineB2BCustomer } from "@/lib/commercial.functions";
import {
  getB2BAdminData,
  reviewB2BRegistration,
  updateB2BCustomerTerms,
  type B2BCustomerGroup,
  type B2BPriceTable,
} from "@/lib/b2b.functions";

export const Route = createFileRoute("/_authenticated/admin/cadastros-b2b")({
  head: () => ({ meta: [{ title: "Cadastros B2B · Admin" }] }),
  component: B2BList,
});

type Terms = {
  customerGroup: B2BCustomerGroup;
  priceTable: B2BPriceTable;
  allowedBoletoDays: number[];
  allowInvoice: boolean;
  invoiceDueDays: number;
  maxCardInstallments: number;
};

type Form = {
  name: string;
  document: string;
  phone: string;
  email: string;
  customer_group: B2BCustomerGroup;
  price_table: B2BPriceTable;
  allowed_boleto_days: number[];
  allow_invoice: boolean;
  invoice_due_days: number;
  max_card_installments: number;
};

const defaultTerms: Terms = {
  customerGroup: "oficina",
  priceTable: "C",
  allowedBoletoDays: [15],
  allowInvoice: false,
  invoiceDueDays: 28,
  maxCardInstallments: 6,
};

const initial: Form = {
  name: "",
  document: "",
  phone: "",
  email: "",
  customer_group: "oficina",
  price_table: "C",
  allowed_boleto_days: [15],
  allow_invoice: false,
  invoice_due_days: 28,
  max_card_installments: 6,
};

const input = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

function B2BList() {
  const qc = useQueryClient();
  const loadAdmin = useServerFn(getB2BAdminData);
  const createCustomer = useServerFn(createOfflineB2BCustomer);
  const [form, setForm] = useState<Form>(initial);
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["b2b-admin"],
    queryFn: () => loadAdmin(),
  });
  const registrations = (data?.registrations ?? []) as any[];
  const customers = (data?.customers ?? []) as any[];

  const create = useMutation({
    mutationFn: () => createCustomer({ data: form }),
    onSuccess: () => {
      toast.success("Cliente B2B cadastrado com condições comerciais definidas.");
      setForm(initial);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["b2b-admin"] });
      qc.invalidateQueries({ queryKey: ["commercial-admin"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível cadastrar"),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-700">Gestão comercial</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold">Clientes B2B</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Aprovação, tabela de preço e crédito ficam no mesmo lugar. Boleto e faturado só aparecem no site quando estiverem liberados aqui.
          </p>
        </div>
        <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Novo cliente B2B
        </button>
      </header>

      {open && (
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <div className="mb-5 flex gap-3">
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Building2 className="h-5 w-5"/></div>
            <div><h2 className="font-bold">Cadastro direto no ERP</h2><p className="text-sm text-muted-foreground">Use para clientes do balcão. Se depois o CNPJ criar conta no site, o cadastro poderá ser vinculado.</p></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Razão social / nome"><input className={input} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
            <Field label="CNPJ"><input className={input} value={form.document} onChange={e=>setForm({...form,document:e.target.value})} placeholder="00.000.000/0000-00"/></Field>
            <Field label="WhatsApp"><input className={input} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field>
            <Field label="E-mail (opcional)"><input className={input} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></Field>
          </div>
          <TermsEditor
            value={{
              customerGroup: form.customer_group,
              priceTable: form.price_table,
              allowedBoletoDays: form.allowed_boleto_days,
              allowInvoice: form.allow_invoice,
              invoiceDueDays: form.invoice_due_days,
              maxCardInstallments: form.max_card_installments,
            }}
            onChange={(terms) => setForm({
              ...form,
              customer_group: terms.customerGroup,
              price_table: terms.priceTable,
              allowed_boleto_days: terms.allowedBoletoDays,
              allow_invoice: terms.allowInvoice,
              invoice_due_days: terms.invoiceDueDays,
              max_card_installments: terms.maxCardInstallments,
            })}
          />
          <div className="mt-5 flex justify-end gap-3">
            <button onClick={()=>setOpen(false)} className="rounded-xl border px-4 py-2 text-sm font-semibold">Cancelar</button>
            <button disabled={create.isPending} onClick={()=>create.mutate()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {create.isPending ? "Salvando…" : "Cadastrar e liberar B2B"}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b p-5">
          <Users className="h-5 w-5 text-violet-600"/>
          <div><h2 className="font-bold">Solicitações do site</h2><p className="text-sm text-muted-foreground">Analise o CNPJ e defina a condição comercial antes de aprovar.</p></div>
        </div>
        <div className="divide-y">
          {isLoading ? <p className="p-5 text-sm text-muted-foreground">Carregando…</p>
            : registrations.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma solicitação B2B recebida.</p>
            : registrations.map((registration:any) => (
              <RegistrationCard key={registration.id} registration={registration} onChanged={() => qc.invalidateQueries({ queryKey: ["b2b-admin"] })}/>
            ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b p-5">
          <Settings2 className="h-5 w-5 text-blue-600"/>
          <div><h2 className="font-bold">Clientes e condições vigentes</h2><p className="text-sm text-muted-foreground">Altere tabela e crédito sem recriar o cliente.</p></div>
        </div>
        <div className="divide-y">
          {customers.filter((c:any) => c.b2b_status === "approved").length === 0
            ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhum cliente B2B aprovado ainda.</p>
            : customers.filter((c:any) => c.b2b_status === "approved").map((customer:any) => (
              <CustomerTermsRow key={customer.id} customer={customer} onChanged={() => qc.invalidateQueries({ queryKey: ["b2b-admin"] })}/>
            ))}
        </div>
      </section>
    </div>
  );
}

function RegistrationCard({ registration, onChanged }: { registration:any; onChanged:()=>void }) {
  const review = useServerFn(reviewB2BRegistration);
  const [terms, setTerms] = useState<Terms>(defaultTerms);
  const [notes, setNotes] = useState(registration.admin_notes ?? "");
  const [open, setOpen] = useState(registration.status === "pendente");

  const mutation = useMutation({
    mutationFn: (decision: "approve" | "reject") => review({
      data: {
        registrationId: registration.id,
        decision,
        adminNotes: notes,
        terms: decision === "approve" ? terms : undefined,
      },
    }),
    onSuccess: (_, decision) => {
      toast.success(decision === "approve" ? "Cliente B2B aprovado." : "Solicitação reprovada.");
      setOpen(false);
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível revisar"),
  });

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{registration.razao_social}</p>
          <p className="text-sm text-muted-foreground">CNPJ {registration.cnpj} · {registration.whatsapp} · {registration.cidade}{registration.estado ? `/${registration.estado}` : ""}</p>
          <p className="mt-1 text-xs text-slate-500">{registration.segmento}{registration.volume_medio_compra ? ` · ${registration.volume_medio_compra}/mês` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={registration.status}/>
          {registration.status === "pendente" && <button onClick={()=>setOpen(!open)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">{open ? "Fechar" : "Analisar"}</button>}
        </div>
      </div>
      {open && registration.status === "pendente" && (
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <TermsEditor value={terms} onChange={setTerms}/>
          <Field label="Observação interna">
            <textarea className={input} value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Ex.: limite aprovado após análise comercial"/>
          </Field>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button disabled={mutation.isPending} onClick={()=>mutation.mutate("reject")} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-4 py-2 text-sm font-bold text-rose-700"><X className="h-4 w-4"/> Reprovar</button>
            <button disabled={mutation.isPending} onClick={()=>mutation.mutate("approve")} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white"><Check className="h-4 w-4"/> Aprovar com estas condições</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerTermsRow({ customer, onChanged }: { customer:any; onChanged:()=>void }) {
  const save = useServerFn(updateB2BCustomerTerms);
  const current = customer.commercial;
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<Terms>({
    customerGroup: (customer.customer_group ?? "oficina") as B2BCustomerGroup,
    priceTable: (current?.price_table ?? "C") as B2BPriceTable,
    allowedBoletoDays: current?.allowed_boleto_days ?? [15],
    allowInvoice: Boolean(current?.allow_invoice ?? false),
    invoiceDueDays: Number(current?.invoice_due_days ?? 28),
    maxCardInstallments: Number(current?.max_card_installments ?? 6),
  });
  const mutation = useMutation({
    mutationFn: () => save({ data: { customerId: customer.id, terms } }),
    onSuccess: () => { toast.success("Condição comercial atualizada."); setOpen(false); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível atualizar"),
  });

  return <div className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-semibold">{customer.name}</p>
        <p className="text-sm text-muted-foreground">
          CNPJ {customer.document} · {groupLabel(customer.customer_group)} · Tabela {current?.price_table ?? "C"}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Boleto: {(current?.allowed_boleto_days ?? [15]).length ? (current?.allowed_boleto_days ?? [15]).map((d:number)=>`${d}d`).join(", ") : "não liberado"}
          {" · "}Cartão: até {current?.max_card_installments ?? 6}x
          {" · "}Faturado: {current?.allow_invoice ? `${current.invoice_due_days ?? 28}d` : "não liberado"}
        </p>
      </div>
      <button onClick={()=>setOpen(!open)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold">{open ? "Fechar" : "Editar condições"}</button>
    </div>
    {open && <div className="mt-4 rounded-xl bg-slate-50 p-4"><TermsEditor value={terms} onChange={setTerms}/><div className="mt-4 flex justify-end"><button disabled={mutation.isPending} onClick={()=>mutation.mutate()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">Salvar condições</button></div></div>}
  </div>;
}

function TermsEditor({ value, onChange }: { value: Terms; onChange:(terms:Terms)=>void }) {
  const toggleDay = (day:number) => {
    const next = value.allowedBoletoDays.includes(day)
      ? value.allowedBoletoDays.filter(d=>d!==day)
      : [...value.allowedBoletoDays, day].sort((a,b)=>a-b);
    onChange({ ...value, allowedBoletoDays: next });
  };
  return <div className="mb-4 grid gap-4 md:grid-cols-3">
    <Field label="Tipo de cliente">
      <select className={input} value={value.customerGroup} onChange={e=>onChange({...value,customerGroup:e.target.value as B2BCustomerGroup})}>
        <option value="oficina">Oficina</option><option value="revendedor">Revendedor</option><option value="distribuidor">Distribuidor</option>
      </select>
    </Field>
    <Field label="Tabela de preço">
      <select className={input} value={value.priceTable} onChange={e=>onChange({...value,priceTable:e.target.value as B2BPriceTable})}>
        <option value="C">C — inicial / menor volume</option><option value="B">B — cliente frequente</option><option value="A">A — alto volume</option>
      </select>
    </Field>
    <Field label="Cartão">
      <select className={input} value={value.maxCardInstallments} onChange={e=>onChange({...value,maxCardInstallments:Number(e.target.value)})}>
        {[1,2,3,4,5,6].map(n=><option key={n} value={n}>Até {n}x</option>)}
      </select>
    </Field>
    <div className="md:col-span-2">
      <span className="text-sm font-semibold">Prazos de boleto liberados</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {[15,30,45,60,90,120].map(day=><label key={day} className="flex items-center gap-1 rounded-lg border bg-white px-2.5 py-2 text-xs"><input type="checkbox" checked={value.allowedBoletoDays.includes(day)} onChange={()=>toggleDay(day)}/>{day} dias</label>)}
      </div>
    </div>
    <div className="rounded-xl border bg-white p-3">
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={value.allowInvoice} onChange={e=>onChange({...value,allowInvoice:e.target.checked})}/> Liberar faturado</label>
      {value.allowInvoice && <label className="mt-2 block text-xs text-slate-600">Prazo<input type="number" min={1} max={120} className={input} value={value.invoiceDueDays} onChange={e=>onChange({...value,invoiceDueDays:Number(e.target.value)})}/></label>}
    </div>
  </div>;
}

function StatusPill({ status }: { status:string }) {
  const cls = status === "aprovado" ? "bg-emerald-50 text-emerald-700" : status === "reprovado" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{status}</span>;
}
function groupLabel(group:string) {
  return group === "oficina" ? "Oficina" : group === "revendedor" ? "Revendedor" : group === "distribuidor" ? "Distribuidor" : group;
}
function Field({ label, children }: { label:string; children:React.ReactNode }) {
  return <label className="text-sm font-semibold">{label}{children}</label>;
}
