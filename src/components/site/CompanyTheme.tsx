import { useLayoutEffect } from "react";
import { useCompanyProfile } from "@/lib/company";

export function CompanyTheme() {
  const { data } = useCompanyProfile();

  useLayoutEffect(() => {
    if (!data) return;

    const root = document.documentElement;
    root.style.setProperty("--primary", data.primary_color);
    root.style.setProperty("--brand", data.primary_color);
    root.style.setProperty("--ring", data.primary_color);
    root.style.setProperty("--secondary", data.secondary_color);
    root.style.setProperty("--hot", data.accent_color);
    document.title = data.store_title || data.trade_name;

    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeColor?.setAttribute("content", data.primary_color);

    if (data.favicon_url) {
      document
        .querySelectorAll<HTMLLinkElement>("link[rel='icon'], link[rel='shortcut icon']")
        .forEach((icon) => icon.remove());

      const favicon = document.createElement("link");
      favicon.rel = "icon";
      favicon.type = "image/webp";
      favicon.href = data.favicon_url;
      document.head.appendChild(favicon);

      const shortcutIcon = document.createElement("link");
      shortcutIcon.rel = "shortcut icon";
      shortcutIcon.type = "image/webp";
      shortcutIcon.href = data.favicon_url;
      document.head.appendChild(shortcutIcon);
    }
  }, [data]);

  return null;
}
