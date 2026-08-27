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
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-bold uppercase text-primary-foreground"
          >
            Tentar novamente
          </button>
          <a href="/" className="rounded-md border border-input px-4 py-2 text-sm font-semibold">Ir para a home</a>
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
      { name: "description", content: "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores." },
      { name: "author", content: "Norte Sul Acessórios e Peças" },
      { property: "og:title", content: "Norte Sul Acessórios e Peças · Loja e Atacado Automotivo" },
      { property: "og:description", content: "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#071a3d" },
      { name: "twitter:title", content: "Norte Sul Acessórios e Peças · Loja e Atacado Automotivo" },
      { name: "twitter:description", content: "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/cc1f167f-b441-4e0e-830e-86e0b5028c2e/id-preview-b464768f--85fdfc37-b145-4339-b4a4-c0cd11eacb03.lovable.app-1783348033756.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/cc1f167f-b441-4e0e-830e-86e0b5028c2e/id-preview-b464768f--85fdfc37-b145-4339-b4a4-c0cd11eacb03.lovable.app-1783348033756.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: BRAND_ICON, type: "image/webp" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=Inter:wght@400;500;600;700&family=Nunito:wght@400;500;600;700;800;900&display=swap" },
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
