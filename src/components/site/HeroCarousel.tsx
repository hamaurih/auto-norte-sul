import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  link_url: string | null;
  cta_label: string | null;
}

function versionImageUrl(url: string, version: string) {
  if (!url) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}ns_v=${encodeURIComponent(version)}`;
}

export function HeroCarousel({ banners }: { banners: Banner[] }) {
  const [i, setI] = useState(0);
  // A per-page token forces the browser/CDN to revalidate the hero asset instead
  // of painting bytes cached under a reused banner URL from an older site version.
  const [pageImageVersion] = useState(() => Date.now().toString(36));
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (banners.length === 0) {
      setI(0);
      return;
    }
    setI((current) => Math.min(current, banners.length - 1));
  }, [banners.length]);

  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => setI((v) => (v + 1) % banners.length), 6000);
    return () => clearInterval(t);
  }, [banners.length]);

  const b = banners[i] ?? banners[0];
  const imageSrc = b ? versionImageUrl(b.image_url, `${b.id}-${pageImageVersion}`) : "";

  useEffect(() => {
    // Never leave the previous bitmap visible while the next/current source is
    // loading. The gradient remains as a stable visual placeholder.
    setLoadedSrc(null);
  }, [imageSrc]);

  if (!b) return null;

  return (
    <section className="relative overflow-hidden bg-slate-50">
      <div className="container-x">
        <div className="relative aspect-[5/4] w-full overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-primary/80 shadow-xl md:aspect-[16/6]">
          <img
            key={imageSrc}
            src={imageSrc}
            alt={b.title}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            onLoad={(e) => {
              const img = e.currentTarget;
              const reveal = () => setLoadedSrc(imageSrc);
              if (typeof img.decode === "function") {
                void img
                  .decode()
                  .catch(() => undefined)
                  .finally(reveal);
              } else {
                reveal();
              }
            }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
              loadedSrc === imageSrc ? "opacity-100" : "opacity-0"
            }`}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/70 to-slate-950/10" />
          <div className="relative flex h-full max-w-2xl flex-col justify-center gap-4 p-7 text-white md:p-12">
            <span className="w-fit rounded-full bg-amber-400 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-950">
              Destaque Norte Sul
            </span>
            <h2 className="text-3xl font-extrabold leading-[1.05] tracking-tight md:text-5xl">
              {b.title}
            </h2>
            {b.subtitle && (
              <p className="max-w-md text-sm leading-relaxed text-white/85 md:text-base">
                {b.subtitle}
              </p>
            )}
            {b.link_url && (
              <Link
                to={b.link_url as never}
                className="w-fit rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:bg-amber-300"
              >
                {b.cta_label ?? "Ver mais"}
              </Link>
            )}
          </div>
          {banners.length > 1 && (
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1">
              {banners.map((_, k) => (
                <button
                  key={k}
                  onClick={() => setI(k)}
                  className={`h-1.5 rounded-full transition-all ${k === i ? "w-8 bg-amber-400" : "w-3 bg-white/50"}`}
                  aria-label={`Banner ${k + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function Rail({
  title,
  subtitle,
  children,
  viewAllHref,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  viewAllHref?: string;
}) {
  return (
    <section className="container-x mt-8">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h3 className="font-display text-2xl font-bold uppercase leading-none">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {viewAllHref && (
          <Link
            to={viewAllHref as never}
            className="text-xs font-semibold uppercase text-primary hover:underline"
          >
            Ver todos →
          </Link>
        )}
      </div>
      <div className="scroll-rail">{children}</div>
    </section>
  );
}
