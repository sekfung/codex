import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Codex Desktop frontend (see ../CONTEXT.md, ../docs/adr/). Port 1420 and
// strictPort match ../tauri.conf.json's `build.devUrl` — Tauri's webview
// points at a fixed port, so this can't silently fall back to another one.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    // shadcn/ui components are written against this alias (ADR-0019); it is
    // mirrored in tsconfig.json so the type-checker resolves it too.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  // Dev-mode dependency pre-bundling must use the same target as the
  // production build. Vite's default here is a browser-matrix list that
  // includes `safari14`, and esbuild treats Safari 14 as not supporting
  // destructuring (it has a genuine destructuring bug) while also not being
  // able to lower it — so any dependency using plain `let {a} = x` fails to
  // pre-bundle. Radix's `@floating-ui` does exactly that. We only ever run in
  // a modern system webview (WebKitGTK / WKWebView / WebView2), so there is
  // nothing to gain from the wider matrix.
  optimizeDeps: {
    esbuildOptions: {
      target: "es2021",
    },
  },
  build: {
    target: "es2021",
    outDir: "dist",
    sourcemap: true,
  },
});
