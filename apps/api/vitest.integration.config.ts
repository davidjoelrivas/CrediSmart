import { defineConfig } from "vitest/config";

// Pruebas de integración: usan una base PostgreSQL real (se crea y migra sola antes de correr).
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["src/testing/postgres/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
