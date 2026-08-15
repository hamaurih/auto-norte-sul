import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SupplyGuard } from "@/components/admin/SupplyGuard";
import {
  listSuppliers,
  setSupplierActive,
  upsertSupplier,
  deleteSupplier,
  type SupplierInput,
} from "@/lib/supplies.functions";

export const Route = createFileRoute("/_authenticated/admin/fornecedores")({
  head: () => ({
    meta: [
      { title: "Fornecedores · Admin" },
      { name: "description", content: "Cadastro de fornecedores do módulo de suprimentos." },
    ],
  }),
  component: GuardedFornecedoresPage,
});

const emptyForm: SupplierInput = {
  legal_name: "",
  trade_name: "",
  tax_id: "",
  email: "",
  phone: "",
  city: "",
  state: "",
  contact_name: "",
  payment_terms: "",
  average_lead_days: null,
  notes: "",
  active: true,
};

function FornecedoresPage() {
  const listFn = useServerFn(listSuppliers);
  const upsertFn = useServerFn(upsertSupplier);
  const toggleFn = useServerFn(setSupplierActive);
  const removeFn = useServerFn(deleteSupplier);
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [form, setForm] = useState<SupplierInput>(emptyForm);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["suppliers", search],
    queryFn: () => listFn({ data: { search } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    qc.invalidateQueries({ queryKey: ["supplies-overview"] });
  };

  const save = useMutation({
    mutationFn: (input: SupplierInput) => upsertFn({ data: input }),
    onSuccess: () => {
      toast.success(form.id ? "Fornecedor atualizado" : "Fornecedor cadastrado");
      setForm(emptyForm);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; active: boolean }) => toggleFn({ data: input }),
    onSuccess: () => {
      toast.success("Situação atualizada");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (input: { id: string }) => removeFn({ data: input }),
    onSuccess: () => {
      toast.success("Fornecedor excluído");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="admin-page-hero flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-amber-700">Rede de parceiros</p>\n          <h1 className="mt-1 font-display text-3xl font-bold">Fornecedores</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Base de fornecedores usada nos pedidos de compra e recebimentos.
          </p>
        </div>
        <Input
          className="w-full sm:w-72"
          placeholder="Buscar por razão social, nome fantasia ou CNPJ"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </header>

      <form
        className="grid gap-3 rounded-3xl border border-violet-200/70 bg-gradient-to-br from-white to-violet-50/70 p-5 shadow-sm md:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(form);
        }}
      >
        <h2 className="md:col-span-3 font-display text-lg font-bold">
          {form.id ? "Editar fornecedor" : "Novo fornecedor"}
        </h2>
        <Input
          placeholder="Razão social *"
          value={form.legal_name}
          onChange={(event) => setForm({ ...form, legal_name: event.target.value })}
        />
        <Input
          placeholder="Nome fantasia"
          value={form.trade_name ?? ""}
          onChange={(event) => setForm({ ...form, trade_name: event.target.value })}
        />
        <Input
          placeholder="CNPJ/CPF"
          value={form.tax_id ?? ""}
          onChange={(event) => setForm({ ...form, tax_id: event.target.value })}
        />
        <Input
          placeholder="Contato"
          value={form.contact_name ?? ""}
          onChange={(event) => setForm({ ...form, contact_name: event.target.value })}
        />
        <Input
          placeholder="E-mail"
          type="email"
          value={form.email ?? ""}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />
        <Input
          placeholder="Telefone"
          value={form.phone ?? ""}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
        />
        <Input
          placeholder="Cidade"
          value={form.city ?? ""}
          onChange={(event) => setForm({ ...form, city: event.target.value })}
        />
        <Input
          placeholder="UF"
          maxLength={2}
          value={form.state ?? ""}
          onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })}
        />
        <Input
          placeholder="Prazo médio de entrega (dias)"
          inputMode="numeric"
          value={form.average_lead_days == null ? "" : String(form.average_lead_days)}
          onChange={(event) =>
            setForm({
              ...form,
              average_lead_days: event.target.value === "" ? null : Number(event.target.value.replace(/\D/g, "")),
            })
          }
        />
        <Input
          className="md:col-span-2"
          placeholder="Condições de pagamento (ex.: 30/60 dias)"
          value={form.payment_terms ?? ""}
          onChange={(event) => setForm({ ...form, payment_terms: event.target.value })}
        />
        <Textarea
          className="md:col-span-3"
          placeholder="Observações"
          value={form.notes ?? ""}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
        <div className="flex gap-2 md:col-span-3">
          <Button type="submit" disabled={save.isPending}>
            {form.id ? "Salvar alterações" : "Cadastrar fornecedor"}
          </Button>
          {form.id && (
            <Button type="button" variant="outline" onClick={() => setForm(emptyForm)}>
              Cancelar edição
            </Button>
          )}
        </div>
      </form>

      {isError && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/5 p-4 text-sm">
          {(error as Error)?.message ?? "Não foi possível carregar os fornecedores."}
        </div>
      )}

      <div className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando fornecedores…</p>}
        {!isLoading && (data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum fornecedor cadastrado ainda.</p>
        )}
        {(data ?? []).map((supplier: any) => (
          <div
            key={supplier.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-amber-200/70 bg-gradient-to-br from-white to-amber-50/60 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="min-w-0">
              <div className="font-display text-lg font-bold">
                {supplier.legal_name}
                {supplier.trade_name && (
                  <span className="ml-2 text-xs text-muted-foreground">({supplier.trade_name})</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {[supplier.tax_id, supplier.city && `${supplier.city}${supplier.state ? `/${supplier.state}` : ""}`, supplier.phone, supplier.email]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {supplier.average_lead_days != null && `Prazo médio ${supplier.average_lead_days} dias`}
                {supplier.payment_terms && ` · ${supplier.payment_terms}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  supplier.active ? "bg-green-500/10 text-green-700" : "bg-muted text-muted-foreground"
                }`}
              >
                {supplier.active ? "Ativo" : "Inativo"}
              </span>
              <Button variant="outline" size="sm" onClick={() => setForm({ ...emptyForm, ...supplier })}>
                Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggle.mutate({ id: supplier.id, active: !supplier.active })}
              >
                {supplier.active ? "Desativar" : "Ativar"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm("Excluir este fornecedor? Só é possível se não houver pedidos de compra.")) {
                    remove.mutate({ id: supplier.id });
                  }
                }}
              >
                Excluir
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuardedFornecedoresPage() {
  return (
    <SupplyGuard>
      <FornecedoresPage />
    </SupplyGuard>
  );
}
