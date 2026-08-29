import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Image, MapPin, Palette, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAccessContext } from "@/lib/access";
import { useCompanyProfile, type CompanyProfile } from "@/lib/company";
import { saveCompanyProfile, type CompanyProfileInput } from "@/lib/company.functions";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  head: () => ({ meta: [{ title: "Empresa e identidade visual · Admin" }] }),
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });
    const context = await fetchAccessContext();
    if (context.organizations.length === 0 && context.tenants.length === 0) {
      throw redirect({ to: "/ativacao" });
    }
  },
  component: CompanySettings,
});

const empty: CompanyProfileInput = {
  legal_name: "", trade_name: "", tax_id: "", state_registration: "",
  municipal_registration: "", email: "", phone: "", whatsapp: "", website: "",
  address_zip: "", address_street: "", address_number: "", address_complement: "",
  address_neighborhood: "", address_city: "", address_state: "",
  logo_url: "", logo_dark_url: "", favicon_url: "",
  primary_color: "#c8102e", secondary_color: "#171923", accent_color: "#f59e0b",
  store_title: "", store_description: "", footer_text: "",
  business_hours: "", instagram_url: "", facebook_url: "", youtube_url: "",
};

function CompanySettings() {
  const { data, isLoading } = useCompanyProfile();
  const [form, setForm] = useState<CompanyProfileInput>(empty);
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!data) return;
    const { tenant_id: _tenant, ...profile } = data;
    setForm(Object.fromEntries(
      Object.entries(profile).map(([key, value]) => [key, value ?? ""]),
    ) as CompanyProfileInput);
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => saveCompanyProfile({ data: form }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["company-profile"] });
      toast.success("Dados da empresa atualizados.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const set = (field: keyof CompanyProfileInput, value: string) =>
    setForm((current) => ({ ...current, [field]: value || null }) as CompanyProfileInput);

  async function uploadLogo(file: File, field: "logo_url" | "logo_dark_url" | "favicon_url") {
    if (!data?.tenant_id) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${data.tenant_id}/${field}-${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("tenant-branding").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw error;
      const { data: publicUrl } = supabase.storage.from("tenant-branding").getPublicUrl(path);
      set(field, publicUrl.publicUrl);
      toast.success("Imagem enviada. Clique em Salvar alterações.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar imagem");
    } finally {
      setUploading(false);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando configurações…</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase">Empresa e identidade visual</h1>
        <p className="text-sm text-muted-foreground">
          Estes dados pertencem somente ao ambiente selecionado: conta real ou conta de teste.
        </p>
      </div>

      <Section icon={Building2} title="Dados empresariais">
        <Grid>
          <Field label="Razão social"><Input value={form.legal_name} onChange={(v) => set("legal_name", v)} /></Field>
          <Field label="Nome fantasia"><Input required value={form.trade_name} onChange={(v) => set("trade_name", v)} /></Field>
          <Field label="CNPJ / CPF"><Input value={form.tax_id} onChange={(v) => set("tax_id", v)} /></Field>
          <Field label="Inscrição estadual"><Input value={form.state_registration} onChange={(v) => set("state_registration", v)} /></Field>
          <Field label="Inscrição municipal"><Input value={form.municipal_registration} onChange={(v) => set("municipal_registration", v)} /></Field>
          <Field label="Site"><Input value={form.website} onChange={(v) => set("website", v)} /></Field>
          <Field label="E-mail"><Input type="email" value={form.email} onChange={(v) => set("email", v)} /></Field>
          <Field label="Telefone"><Input value={form.phone} onChange={(v) => set("phone", v)} /></Field>
          <Field label="WhatsApp"><Input value={form.whatsapp} onChange={(v) => set("whatsapp", v)} /></Field>
          <Field label="Horário de atendimento"><Input value={form.business_hours} onChange={(v) => set("business_hours", v)} /></Field>
        </Grid>
      </Section>

      <Section icon={MapPin} title="Endereço">
        <Grid>
          <Field label="CEP"><Input value={form.address_zip} onChange={(v) => set("address_zip", v)} /></Field>
          <Field label="Rua"><Input value={form.address_street} onChange={(v) => set("address_street", v)} /></Field>
          <Field label="Número"><Input value={form.address_number} onChange={(v) => set("address_number", v)} /></Field>
          <Field label="Complemento"><Input value={form.address_complement} onChange={(v) => set("address_complement", v)} /></Field>
          <Field label="Bairro"><Input value={form.address_neighborhood} onChange={(v) => set("address_neighborhood", v)} /></Field>
          <Field label="Cidade"><Input value={form.address_city} onChange={(v) => set("address_city", v)} /></Field>
          <Field label="UF"><Input value={form.address_state} maxLength={2} onChange={(v) => set("address_state", v.toUpperCase())} /></Field>
        </Grid>
      </Section>

      <Section icon={Image} title="Logos e comunicação">
        <Grid>
          <Upload label="Logo principal" url={form.logo_url} disabled={uploading} onFile={(f) => uploadLogo(f, "logo_url")} />
          <Upload label="Logo para fundo escuro" url={form.logo_dark_url} disabled={uploading} onFile={(f) => uploadLogo(f, "logo_dark_url")} />
          <Upload label="Favicon" url={form.favicon_url} disabled={uploading} onFile={(f) => uploadLogo(f, "favicon_url")} />
          <Field label="Título da loja"><Input value={form.store_title} onChange={(v) => set("store_title", v)} /></Field>
          <Field label="Descrição da loja"><Textarea value={form.store_description} onChange={(v) => set("store_description", v)} /></Field>
          <Field label="Texto do rodapé"><Textarea value={form.footer_text} onChange={(v) => set("footer_text", v)} /></Field>
          <Field label="Instagram"><Input value={form.instagram_url} onChange={(v) => set("instagram_url", v)} /></Field>
          <Field label="Facebook"><Input value={form.facebook_url} onChange={(v) => set("facebook_url", v)} /></Field>
          <Field label="YouTube"><Input value={form.youtube_url} onChange={(v) => set("youtube_url", v)} /></Field>
        </Grid>
      </Section>

      <Section icon={Palette} title="Cores da marca">
        <div className="grid gap-4 sm:grid-cols-3">
          <Color label="Cor principal" value={form.primary_color} onChange={(v) => set("primary_color", v)} />
          <Color label="Cor secundária" value={form.secondary_color} onChange={(v) => set("secondary_color", v)} />
          <Color label="Cor de destaque" value={form.accent_color} onChange={(v) => set("accent_color", v)} />
        </div>
      </Section>

      <div className="sticky bottom-4 flex justify-end">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || uploading || !form.trade_name}
          className="flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-bold uppercase text-primary-foreground shadow-lg disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {mutation.isPending ? "Salvando…" : "Salvar alterações"}
        </button>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Building2; title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
    <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-bold uppercase"><Icon className="h-5 w-5 text-primary" />{title}</h2>
    {children}
  </section>;
}
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid gap-4 md:grid-cols-2">{children}</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">{label}</span>{children}</label>; }
const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary";
function Input({ value, onChange, ...props }: { value: string | null; onChange: (value: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return <input {...props} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
}
function Textarea({ value, onChange }: { value: string | null; onChange: (value: string) => void }) {
  return <textarea rows={3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputClass} />;
}
function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><div className="flex gap-2"><input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-14 rounded border" /><Input value={value} onChange={onChange} /></div></Field>;
}
function Upload({ label, url, disabled, onFile }: { label: string; url: string | null; disabled: boolean; onFile: (file: File) => void }) {
  return <Field label={label}><div className="flex items-center gap-3 rounded-md border border-dashed p-3">
    {url ? <img src={url} alt="" className="h-14 w-24 object-contain" /> : <div className="grid h-14 w-24 place-items-center bg-muted text-xs">Sem imagem</div>}
    <input disabled={disabled} type="file" accept="image/png,image/jpeg,image/webp,image/x-icon" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="min-w-0 text-xs" />
  </div></Field>;
}
