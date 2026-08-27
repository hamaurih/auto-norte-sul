import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { TenantEnvironmentSwitcher } from "@/components/admin/TenantEnvironmentSwitcher";
import { CompanyTheme } from "@/components/site/CompanyTheme";

const BRAND_ICON = "data:image/webp;base64,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";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1 items-center justify-center bg-background px-4 py-20">
        <div className="max-w-md text-center">
          <h1 className="font-display text-7xl font-black text-primary">404</h1>
          <h2 className="mt-2 font-display text-xl font-bold uppercase">Página não encontrada</h2>
          <p className="mt-2 text-sm text-muted-foreground">O endereço que você procura não existe ou foi movido.</p>
          <Link to="/" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground hover:brightness-110">
            Voltar para a home
          </Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-xl font-bold uppercase">Algo deu errado</h1>
        <p className="mt-2 text-sm text-muted-foreground">Não conseguimos carregar esta página agora.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground"
          >
            Tentar novamente
          </button>
          <a href="/" className="rounded-md border border-input px-4 py-2 text-sm font-semibold">
            Ir para a home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Norte Sul Acessórios e Peças · Loja e Atacado Automotivo" },
      {
        name: "description",
        content:
          "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores.",
      },
      { name: "author", content: "Norte Sul Acessórios e Peças" },
      { property: "og:title", content: "Norte Sul Acessórios e Peças · Loja e Atacado Automotivo" },
      {
        property: "og:description",
        content:
          "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#071a3d" },
      { name: "twitter:title", content: "Norte Sul Acessórios e Peças · Loja e Atacado Automotivo" },
      {
        name: "twitter:description",
        content:
          "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/cc1f167f-b441-4e0e-830e-86e0b5028c2e/id-preview-b464768f--85fdfc37-b145-4339-b4a4-c0cd11eacb03.lovable.app-1783348033756.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/cc1f167f-b441-4e0e-830e-86e0b5028c2e/id-preview-b464768f--85fdfc37-b145-4339-b4a4-c0cd11eacb03.lovable.app-1783348033756.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: BRAND_ICON, type: "image/webp" },
      { rel: "shortcut icon", href: BRAND_ICON, type: "image/webp" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=Inter:wght@400;500;600;700&family=Nunito:wght@400;500;600;700;800;900&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isAuth = path.startsWith("/auth");
  const isPanel = path.startsWith("/admin") || path.startsWith("/vendedor");
  const hideChrome = isAuth || isPanel;

  return (
    <QueryClientProvider client={queryClient}>
      <CompanyTheme />
      <div className="flex min-h-screen flex-col">
        {!hideChrome && <Header />}
        {isPanel && <TenantEnvironmentSwitcher />}
        <main className="flex-1">
          <Outlet />
        </main>
        {!hideChrome && <Footer />}
      </div>
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  );
}
