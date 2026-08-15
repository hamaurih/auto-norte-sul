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
      { title: "Norte Sul Acessórios · Loja e Atacado Automotivo" },
      { name: "description", content: "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores." },
      { name: "author", content: "Norte Sul Acessórios" },
      { property: "og:title", content: "Norte Sul Acessórios · Loja e Atacado Automotivo" },
      { property: "og:description", content: "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#c8102e" },
      { name: "twitter:title", content: "Norte Sul Acessórios · Loja e Atacado Automotivo" },
      { name: "twitter:description", content: "Som automotivo, farol LED, pneus, alarmes e muito mais. Frete para todo o Brasil e tabela especial para lojistas, oficinas e revendedores." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/cc1f167f-b441-4e0e-830e-86e0b5028c2e/id-preview-b464768f--85fdfc37-b145-4339-b4a4-c0cd11eacb03.lovable.app-1783348033756.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/cc1f167f-b441-4e0e-830e-86e0b5028c2e/id-preview-b464768f--85fdfc37-b145-4339-b4a4-c0cd11eacb03.lovable.app-1783348033756.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
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
