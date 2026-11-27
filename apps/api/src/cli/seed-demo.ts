import { summarize } from "@app/domain";
import { seedDemo } from "../demo/seed-demo";
import { FieldCipher } from "../shared/infrastructure/crypto/field-cipher";
import { createPool, databaseConfigFromEnv } from "../shared/infrastructure/postgres/connection";
import { PostgresDatabase } from "../shared/infrastructure/postgres/postgres-database";
import { SystemClock } from "../shared/infrastructure/system-clock";

const pool = createPool(databaseConfigFromEnv());
try {
  const result = await seedDemo(pool, FieldCipher.fromEnv(), new SystemClock());
  if (!result.created) {
    console.log("La organización demo ya existe: no se cambió nada.");
  } else {
    const entries = await new PostgresDatabase(pool).repositories().ledger.entriesOf(result.organizationId);
    const summary = summarize(entries);
    console.log(`Demo creada: ${result.loans} préstamos y ${result.payments} pagos con recibo.`);
    console.log(`Caja:               ${summary.cash.format()}`);
    console.log(`Capital colocado:   ${summary.portfolio.format()}`);
    console.log(`Intereses ganados:  ${summary.interestIncome.format()}`);
  }
  console.log(`Organización demo: ${result.organizationId}`);
} finally {
  await pool.end();
}
