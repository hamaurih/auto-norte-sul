import fallbackLogo from "@/assets/norte-sul-logo.png.asset.json";
import { useCompanyProfile } from "@/lib/company";

export function CompanyLogo({
  dark = false,
  className,
}: {
  dark?: boolean;
  className?: string;
}) {
  const { data } = useCompanyProfile();
  const src = (dark ? data?.logo_dark_url : data?.logo_url) || data?.logo_url || fallbackLogo.url;
  const name = data?.trade_name || "Norte Sul Acessórios";
  return <img src={src} alt={name} className={className} loading="eager" decoding="async" />;
}
