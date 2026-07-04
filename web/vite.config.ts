import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Wave UI.8 — make sure React/Mantine ends up in the bundle
    // exactly once. `@hca/mantine-workbench` is consumed in dev via
    // a `file:` symlink; without dedupe, Vite could resolve the
    // library's own parent-dir resolution for react to a different
    // node_modules level → duplicate React context, broken
    // hooks. The consumer's own versions are the truth.
    dedupe: [
      "react",
      "react-dom",
      "@mantine/core",
      "@mantine/hooks",
      "@mantine/form",
      "@mantine/modals",
      "@mantine/notifications",
    ],
  },
  optimizeDeps: {
    // Wave UI.9 — exclude the library from the pre-bundle cache.
    // Vite caches pre-bundle contents in node_modules/.vite and
    // invalidates ONLY on changes to vite.config.ts or
    // package.json — source changes inside the library
    // (`hca-mantine-workbench/src/...`) go unseen. With
    // `exclude`, Vite reads the library directly from the symlink
    // path on every reload and HMR works again.
    exclude: ["@hca/mantine-workbench"],
  },
  // Wave UI.8 — the library lives outside web/ and vite's
  // default fs.allow only permits the project root. We allow
  // the parent folder so Vite can serve the library source.
  server: {
    host: true,
    allowedHosts: true,
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
})
