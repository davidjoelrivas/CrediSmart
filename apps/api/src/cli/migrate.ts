import { fileURLToPath } from "node:url";
import { databaseConfigFromEnv } from "../shared/infrastructure/postgres/connection";
import { runMigrations } from "../shared/infrastructure/postgres/migrator";

const directory = fileURLToPath(new URL("../../../../db/migrations", import.meta.url));
const result = await runMigrations(databaseConfigFromEnv(), directory);

for (const file of result.applied) console.log(`aplicada    ${file}`);
for (const file of result.alreadyApplied) console.log(`sin cambios ${file}`);
console.log(`Listo: ${result.applied.length} aplicadas, ${result.alreadyApplied.length} sin cambios.`);
