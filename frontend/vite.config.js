import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "BabyTracker",
        short_name: "BabyTracker",
        description: "Track feeding, sleep, diapers, and milestones for your baby.",
        theme_color: "#0F1117",
        background_color: "#0F1117",
        display: "standalone",
        icons: [
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon-512x512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "masked-icon.svg"],
      devOptions: {
        enabled: false,
      },
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/api\/(gallery|photos)\//,
            handler: "NetworkOnly",
            options: {},
          },
          {
            urlPattern: /\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 86400,
              },
            },
          },
        ],
      },
      meta: {
        mobileWebApp: true,
        ios: {
          appleStatusBarStyle: "black-translucent",
          appleMobileWebAppCapable: "yes",
          appleMobileWebAppTitle: "BabyTracker",
        },
        windows: {
          pwaTile: true,
          pwaTileColor: "#0F1117",
        },
      },
    }),
  ],
  // Use the automatic JSX runtime for esbuild too, so Vitest can transform
  // .jsx test/component files without an explicit `import React`.
  esbuild: { jsx: "automatic" },
  // Component tests need a DOM (jsdom); the pure-logic tests run fine there too.
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.js"],
  },
  base: "./",
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": "http://localhost:8099",
    },
  },
});