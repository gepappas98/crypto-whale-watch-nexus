import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Dynamically import PWA plugin only if available
  const plugins = [react(), mode === "development" && componentTagger()].filter(Boolean);
  
  // Try to add PWA plugin in production
  if (mode === "production") {
    try {
      const { VitePWA } = require("vite-plugin-pwa");
      plugins.push(
        VitePWA({
          registerType: "autoUpdate",
          strategies: "injectManifest",
          srcDir: "public",
          filename: "sw.js",
          manifest: false,
          injectManifest: {
            globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
            globIgnores: ["**/node_modules/**/*", "**/sw.js"],
          },
          workbox: {
            maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
            runtimeCaching: [
              {
                urlPattern: /^https:\/\/api\.coingecko\.com\/.*/i,
                handler: "NetworkFirst",
                options: {
                  cacheName: "coingecko-cache",
                  expiration: { maxEntries: 50, maxAgeSeconds: 300 },
                },
              },
              {
                urlPattern: /^https:\/\/api\.coinpaprika\.com\/.*/i,
                handler: "NetworkFirst",
                options: {
                  cacheName: "paprika-cache",
                  expiration: { maxEntries: 50, maxAgeSeconds: 300 },
                },
              },
              {
                urlPattern: /^https:\/\/api\.dexscreener\.com\/.*/i,
                handler: "NetworkFirst",
                options: {
                  cacheName: "dexscreener-cache",
                  expiration: { maxEntries: 100, maxAgeSeconds: 120 },
                },
              },
            ],
          },
          devOptions: { enabled: false },
        })
      );
      console.log("✅ PWA plugin loaded");
    } catch (e) {
      console.warn("⚠️  PWA plugin not found, building without service worker");
    }
  }

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
    plugins,
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
