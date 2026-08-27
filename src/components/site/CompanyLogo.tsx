import { useCompanyProfile } from "@/lib/company";

const FALLBACK_LOGO = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 170" role="img" aria-label="Norte Sul Acessórios e Peças">
  <g fill="none" stroke="#1677ff" stroke-width="5" stroke-linejoin="round">
    <path d="M279 10l20 43 47 2-36 30 12 46-43-25-43 25 12-46-36-30 47-2z" fill="#f4f7fb"/>
  </g>
  <text x="20" y="115" font-family="Arial,Helvetica,sans-serif" font-size="82" font-weight="900" font-style="italic" fill="#f4f7fb" stroke="#071a3d" stroke-width="4">NORTE</text>
  <text x="350" y="115" font-family="Arial,Helvetica,sans-serif" font-size="82" font-weight="900" font-style="italic" fill="#f4f7fb" stroke="#071a3d" stroke-width="4">SUL</text>
  <text x="151" y="157" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="700" letter-spacing="2" fill="#f4f7fb">ACESSÓRIOS E PEÇAS</text>
</svg>
`)}`;

export function CompanyLogo({
  dark = false,
  className,
}: {
  dark?: boolean;
  className?: string;
}) {
  const { data } = useCompanyProfile();
  const src =
    (dark ? data?.logo_dark_url : data?.logo_url) ||
    data?.logo_url ||
    FALLBACK_LOGO;

  return (
    <img
      src={src}
      alt={data?.trade_name || "Norte Sul Acessórios e Peças"}
      className={className}
      loading="eager"
      decoding="async"
      onError={(event) => {
        if (event.currentTarget.src !== FALLBACK_LOGO) {
          event.currentTarget.src = FALLBACK_LOGO;
        }
      }}
    />
  );
}
