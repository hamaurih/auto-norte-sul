// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, nitro: { ... }, etc... }).
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

const isVercel = Boolean(process.env.VERCEL);

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Vercel hosts production independently from Lovable.
  nitro: {
    preset: isVercel ? "vercel" : "cloudflare",
  },
  vite: {
    // The Lovable MCP plugin expects Lovable's OAuth issuer at runtime.
    // Excluding it on Vercel prevents SSR failures while preserving Lovable development.
    plugins: isVercel ? [] : [mcpPlugin()],
  },
});
