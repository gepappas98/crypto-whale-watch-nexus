import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // Proxy WebSocket for Bybit in dev
      '/v5/public': {
        target: 'wss://stream.bybit.com',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(), 
    mode === "development" && componentTagger(),
    // PWA Plugin - only in production builds
    mode === "production" && VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "public",
      filename: "sw.js",
      manifest: false, // Using custom manifest.json in public/
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        globIgnores: ["**/node_modules/**/*", "**/sw.js"],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3MB
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.coingecko\.com\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "coingecko-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 300, // 5 minutes
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/api\.coinpaprika\.com\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "paprika-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 300,
              },
            },
          },
          {
            urlPattern: /^https:\/\/api\.dexscreener\.com\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "dexscreener-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 120, // 2 minutes
              },
            },
          },
          {
            urlPattern: /^https:\/\/public-api\.birdeye\.so\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "birdeye-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60, // 1 minute
              },
            },
          },
          {
            urlPattern: /^https:\/\/token\.jup\.ag\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "jupiter-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 86400, // 24 hours
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // Disable SW in dev
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
      "@tanstack/query-core"
    ],
  },
  build: {
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate chunks for better caching
          vendor: ["react", "react-dom"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu"],
          charts: ["recharts", "lightweight-charts"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["lovable-tagger"],
  },
}));
