import { Link } from "@tanstack/react-router";
import {
  Phone,
  Mail,
  MapPin,
  MessageCircle,
  Instagram,
  Facebook,
  Youtube,
  ShieldCheck,
  Truck,
  Lock,
} from "lucide-react";
import { CompanyLogo } from "@/components/site/CompanyLogo";
import { useCompanyProfile } from "@/lib/company";

export function Footer() {
  const { data: company } = useCompanyProfile();
  const whatsappHref = company?.whatsapp ? `https://wa.me/${company.whatsapp.replace(/\D/g, "")}` : "#";
  const address = [company?.address_street, company?.address_number, company?.address_city, company?.address_state]
    .filter(Boolean).join(", ");
  return (
    <footer className="mt-16 border-t border-border bg-secondary text-secondary-foreground">
      {/* Trust strip */}
      <div className="border-b border-white/10 bg-black/30">
        <div className="container-x grid grid-cols-2 gap-3 py-4 md:grid-cols-4">
          {[
            { icon: ShieldCheck, label: "Site 100% seguro" },
            { icon: Truck, label: "Envio para todo Brasil" },
            { icon: Lock, label: "Pagamento protegido" },
            { icon: MessageCircle, label: "Atendimento WhatsApp" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <Icon className="h-4 w-4 text-primary" /> {label}
            </div>
          ))}
        </div>
      </div>

      <div className="container-x grid gap-8 py-10 md:grid-cols-5">
        <div className="md:col-span-2">
          <CompanyLogo dark className="h-24 w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]" />
          <p className="mt-3 max-w-sm text-sm text-white/70">
            {company?.store_description || "Som, iluminação, performance e segurança para todo tipo de carro."}
          </p>
          <div className="mt-4 flex gap-2">
            <a
              href={company?.instagram_url || "#"}
              aria-label="Instagram"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition hover:bg-primary"
            >
              <Instagram className="h-4 w-4" />
            </a>
            <a
              href={company?.facebook_url || "#"}
              aria-label="Facebook"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition hover:bg-primary"
            >
              <Facebook className="h-4 w-4" />
            </a>
            <a
              href={company?.youtube_url || "#"}
              aria-label="YouTube"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition hover:bg-primary"
            >
              <Youtube className="h-4 w-4" />
            </a>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition hover:bg-primary"
            >
              <MessageCircle className="h-4 w-4" />
            </a>
          </div>
        </div>

        <div>
          <h4 className="mb-3 font-display text-sm font-bold uppercase tracking-wider">Institucional</h4>
          <ul className="space-y-2 text-sm text-white/70">
            <li><Link to="/" className="hover:text-primary">Sobre {company?.trade_name || "a empresa"}</Link></li>
            <li><Link to="/b2b" className="hover:text-primary">Compre no Atacado</Link></li>
            <li><Link to="/" className="hover:text-primary">Política de Privacidade</Link></li>
            <li><Link to="/" className="hover:text-primary">Trocas e Devoluções</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="mb-3 font-display text-sm font-bold uppercase tracking-wider">Atendimento</h4>
          <ul className="space-y-2 text-sm text-white/70">
            <li className="flex items-center gap-2"><Phone className="h-4 w-4" /> {company?.phone || "Telefone não informado"}</li>
            <li className="flex items-center gap-2"><MessageCircle className="h-4 w-4" /> WhatsApp comercial</li>
            <li className="flex items-center gap-2"><Mail className="h-4 w-4" /> {company?.email || "E-mail não informado"}</li>
            <li className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {address || company?.business_hours || "Endereço não informado"}</li>
            {address && <li className="pl-6 text-xs">{company?.business_hours || "Horário não informado"}</li>}
          </ul>
        </div>

        <div>
          <h4 className="mb-3 font-display text-sm font-bold uppercase tracking-wider">Pagamento</h4>
          <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase text-white/80">
            <span className="rounded bg-white/10 px-2 py-1">PIX</span>
            <span className="rounded bg-white/10 px-2 py-1">Visa</span>
            <span className="rounded bg-white/10 px-2 py-1">Master</span>
            <span className="rounded bg-white/10 px-2 py-1">Elo</span>
            <span className="rounded bg-white/10 px-2 py-1">Boleto</span>
            <span className="rounded bg-white/10 px-2 py-1">B2B 28d</span>
          </div>
          <h4 className="mb-2 mt-5 font-display text-sm font-bold uppercase tracking-wider">Segurança</h4>
          <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase text-white/80">
            <span className="rounded border border-white/10 bg-white/5 px-2 py-1">SSL</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-1">LGPD</span>
            <span className="rounded border border-white/10 bg-white/5 px-2 py-1">Site Seguro</span>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 bg-black/40 py-3 text-center text-xs text-white/50">
        © {new Date().getFullYear()} {company?.trade_name || "Loja"}
        {company?.tax_id ? ` · CNPJ/CPF ${company.tax_id}` : ""} · {company?.footer_text || "Todos os direitos reservados"}
      </div>
    </footer>
  );
}
