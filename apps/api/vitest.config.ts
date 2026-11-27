import { defineConfig } from "vitest/config";

// Pruebas unitarias: no necesitan base de datos. Las de integración con MySQL
// viven en archivos *.integration.test.ts y se corren con `pnpm test:integration`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
