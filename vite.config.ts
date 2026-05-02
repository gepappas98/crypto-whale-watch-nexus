import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: { overlay: false },
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),

      // ✅ PWA: injectManifest strategy — processes public/sw.js and injects
      // the Workbox precache manifest at the self.__WB_MANIFEST placeholder.
      VitePWA({
        registerType: "autoUpdate",
        strategies: "injectManifest",
        srcDir: "public",
        filename: "sw.js",

        // We manage manifest.json ourselves in /public, so disable auto-gen.
        manifest: false,

        injectManifest: {
          // Which built assets to precache
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
          // Don't try to precache the SW itself
          globIgnores: ["**/node_modules/**/*", "**/sw.js"],
          // Allow larger chunks (default is 2 MiB)
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },

        devOptions: {
          // Disabled in dev — the SW was caching stale React chunks and
          // causing "Cannot read properties of null (reading 'useState')".
          enabled: false,
          type: "module",
        },
      }),
    ].filter(Boolean),

    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    build: {
      target: "esnext",
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom"],
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ["lovable-tagger"],
    },
  };
});
