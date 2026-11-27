import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { clientOptions, databaseConfigFromEnv } from "../shared/infrastructure/postgres/connection";
import { inspectDatabase } from "../shared/infrastructure/postgres/inspection";
import { runCli } from "./run-cli";

/** Si el tramo entre esta computadora y el servidor viaja cifrado (TLS). */
function isClientEncrypted(client: pg.Client): boolean {
  const connection = (client as unknown as { connection?: { stream?: { encrypted?: boolean } } }).connection;
  return connection?.stream?.encrypted === true;
}

await runCli(async () => {
  const config = databaseConfigFromEnv();
  const migrationsDirectory = fileURLToPath(new URL("../../../../db/migrations", import.meta.url));
  const expected = (await readdir(migrationsDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).length;

  const client = new pg.Client(clientOptions(config));
  await client.connect();
  try {
    const report = await inspectDatabase(client, expected);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(config.host);
    const encrypted = isClientEncrypted(client);

    console.log(`Servidor:            ${config.host}:${config.port}/${config.database}`);
    console.log(`Versión:             ${report.version.split(",")[0]}`);
    console.log(`Usuario:             ${report.currentUser}`);
    console.log(`Conexión cifrada:    ${encrypted ? "sí (tu equipo → servidor)" : "no"}`);
    console.log(`Tablas:              ${report.tables.length}`);
    console.log(`Migraciones:         ${report.appliedMigrations.length} de ${expected} aplicadas`);
    console.log(
      `Seguridad por fila:  ${report.tablesWithoutRowSecurity.length === 0 ? "activa en todas las tablas" : "FALTA en " + report.tablesWithoutRowSecurity.join(", ")}`,
    );
    console.log(
      `Roles públicos:      ${report.exposedRoleAccess.length === 0 ? "sin acceso a ninguna tabla" : report.exposedRoleAccess.length + " permisos abiertos"}`,
    );

    const problems = [...report.problems];
    if (!isLocal && !encrypted) {
      problems.push("La conexión a un servidor remoto no está cifrada.");
    }
    if (problems.length > 0) {
      console.error("\nProblemas encontrados:");
      for (const problem of problems) console.error(` - ${problem}`);
      process.exitCode = 1;
    } else {
      console.log("\nTodo en orden: la base está lista.");
    }
  } finally {
    await client.end();
  }
});
