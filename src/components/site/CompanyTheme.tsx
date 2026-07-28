import { useEffect } from "react";
import { useCompanyProfile } from "@/lib/company";

export function CompanyTheme() {
  const { data } = useCompanyProfile();

  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    root.style.setProperty("--primary", data.primary_color);
    root.style.setProperty("--brand", data.primary_color);
    root.style.setProperty("--ring", data.primary_color);
    root.style.setProperty("--secondary", data.secondary_color);
    root.style.setProperty("--hot", data.accent_color);
    document.title = data.store_title || data.trade_name;

    if (data.favicon_url) {
      let favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.appendChild(favicon);
      }
      favicon.href = data.favicon_url;
    }
  }, [data]);

  return null;
}
