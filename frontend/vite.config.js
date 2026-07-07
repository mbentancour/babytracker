import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
