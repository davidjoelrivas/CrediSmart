import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { backupFileName, buildDumpArguments } from "../shared/infrastructure/backup";
import { databaseConfigFromEnv, toConnectionUrl } from "../shared/infrastructure/postgres/connection";

const url = toConnectionUrl(databaseConfigFromEnv());
const directory = fileURLToPath(new URL("../../../../backups", import.meta.url));
await mkdir(directory, { recursive: true });
const output = join(directory, backupFileName(new Date()));
const pgDump = process.env.PG_DUMP_PATH ?? "pg_dump";

console.log(`Respaldando hacia ${output} ...`);
const child = spawn(pgDump, buildDumpArguments(url, output), { stdio: "inherit" });
child.on("error", (error) => {
  console.error(`No se pudo ejecutar pg_dump (${pgDump}): ${error.message}`);
  console.error("Indicá la ruta en la variable PG_DUMP_PATH del archivo .env.");
  process.exit(1);
});
child.on("exit", (code) => {
  if (code === 0) {
    console.log("Respaldo terminado. Guardalo en un lugar seguro: contiene datos de clientes.");
  } else {
    console.error(`pg_dump terminó con error (código ${code}).`);
  }
  process.exit(code ?? 1);
});
