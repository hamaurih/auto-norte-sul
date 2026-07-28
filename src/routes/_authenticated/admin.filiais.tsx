import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listBranches, upsertBranch, upsertWarehouse } from "@/lib/inventory.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/filiais")({
  head: () => ({ meta: [{ title: "Filiais · Admin" }] }),
  component: FiliaisPage,
});

function FiliaisPage() {
  const listFn = useServerFn(listBranches);
  const upsertFn = useServerFn(upsertBranch);
  const upsertWhFn = useServerFn(upsertWarehouse);
  const qc = useQueryClient();
  const { data: branches } = useQuery({ queryKey: ["branches-admin"], queryFn: () => listFn() });
  const [form, setForm] = useState({ name: "", code: "", city: "", state: "" });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold uppercase">Filiais e Depósitos</h1>

      <form
        className="grid gap-2 rounded-lg border border-border bg-card p-4 md:grid-cols-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.name || !form.code) return toast.error("Nome e código são obrigatórios");
          await upsertFn({ data: { ...form, active: true } });
          toast.success("Filial criada");
          setForm({ name: "", code: "", city: "", state: "" });
          qc.invalidateQueries({ queryKey: ["branches-admin"] });
        }}
      >
        <Input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input placeholder="Código (único)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
        <Input placeholder="Cidade" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <Input placeholder="UF" maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} />
        <Button type="submit">Adicionar filial</Button>
      </form>

      <div className="space-y-3">
        {(branches ?? []).map((b: any) => (
          <div key={b.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-lg font-bold">
                  {b.name} <span className="text-xs text-muted-foreground">({b.code})</span>
                  {b.is_main && <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary">MATRIZ</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[b.city, b.state].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <span className={`rounded px-2 py-0.5 text-[10px] ${b.active ? "bg-green-500/10 text-green-700" : "bg-muted"}`}>
                {b.active ? "Ativa" : "Inativa"}
              </span>
            </div>
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-bold uppercase text-muted-foreground">Depósitos</div>
              <ul className="space-y-1 text-sm">
                {(b.warehouses ?? []).map((w: any) => (
                  <li key={w.id} className="flex justify-between border-b border-border py-1 last:border-0">
                    <span>{w.name} <span className="text-xs text-muted-foreground">({w.code})</span></span>
                    <span className="text-xs">{w.is_default ? "Padrão" : ""}</span>
                  </li>
                ))}
              </ul>
              <NewWarehouse
                branchId={b.id}
                onAdd={async (payload) => {
                  await upsertWhFn({ data: payload });
                  toast.success("Depósito criado");
                  qc.invalidateQueries({ queryKey: ["branches-admin"] });
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewWarehouse({ branchId, onAdd }: { branchId: string; onAdd: (p: { branch_id: string; name: string; code: string; active: boolean }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name || !code) return;
        await onAdd({ branch_id: branchId, name, code, active: true });
        setName(""); setCode("");
      }}
    >
      <Input placeholder="Nome do depósito" value={name} onChange={(e) => setName(e.target.value)} />
      <Input placeholder="Código" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      <Button type="submit" size="sm" variant="outline">+ Depósito</Button>
    </form>
  );
}
