// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, nitro: { ... }, etc... }).
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Vercel hosts the production app independently from Lovable.
  // Nitro still auto-detects local/Lovable environments, while production builds
  // generate Vercel's serverless output instead of the previous Cloudflare target.
  nitro: {
    preset: process.env.VERCEL ? "vercel" : "cloudflare",
  },
  vite: {
    plugins: [mcpPlugin()],
  },
});
