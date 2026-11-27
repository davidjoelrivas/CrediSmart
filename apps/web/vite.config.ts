import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// En desarrollo, la web (puerto 5173) reenvía /api al servidor (puerto 3000): así la cookie de sesión
// es del mismo origen, igual que en producción.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
