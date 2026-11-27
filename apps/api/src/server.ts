import { buildApp } from "./http/app";
import { composePostgresServices } from "./http/compose-postgres";
import { configFromEnv } from "./http/config";
import { startLateFeeScheduler } from "./http/scheduler";
import { FieldCipher } from "./shared/infrastructure/crypto/field-cipher";
import { createPool, databaseConfigFromEnv, describeConnectionError } from "./shared/infrastructure/postgres/connection";

/**
 * Punto de entrada de producción: un solo servicio que atiende la API y la aplicación web.
 * Variables obligatorias: DATABASE_URL (o las DB_*), FIELD_ENCRYPTION_KEY, FIELD_HASH_KEY, PUBLIC_BASE_URL.
 */
async function main(): Promise<void> {
  const config = configFromEnv();
  const pool = createPool(databaseConfigFromEnv());
  const services = composePostgresServices(pool, FieldCipher.fromEnv());
  await services.checkHealth();

  const app = await buildApp(services, config);
  const scheduler = startLateFeeScheduler(services, app.log);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
  app.log.info({ port, web: config.webDist !== null }, "CrediSmart listo");

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "cerrando");
    scheduler.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(`\nNo se pudo iniciar CrediSmart: ${describeConnectionError(error)}`);
  process.exit(1);
});
