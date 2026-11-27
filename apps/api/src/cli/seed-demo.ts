import { randomBytes } from "node:crypto";
import { summarize } from "@app/domain";
import { ensureDemoPrescreening, ensureDemoUsers, seedDemo, upgradeDemoLateFees } from "../demo/seed-demo";
import { CreateUser } from "../modules/identity/application/create-user";
import { PostgresUserRepository } from "../modules/identity/infrastructure/postgres/postgres-identity-repositories";
import { ScryptPasswordHasher } from "../modules/identity/infrastructure/scrypt-password-hasher";
import { FieldCipher } from "../shared/infrastructure/crypto/field-cipher";
import { createPool, databaseConfigFromEnv } from "../shared/infrastructure/postgres/connection";
import { PostgresDatabase } from "../shared/infrastructure/postgres/postgres-database";
import { UuidV7Generator } from "../shared/infrastructure/postgres/uuid";
import { SystemClock } from "../shared/infrastructure/system-clock";
import { runCli } from "./run-cli";

/**
 * Crea (o actualiza) la organización de demostración y sus usuarios.
 * La contraseña de la demo sale de DEMO_PASSWORD; si no existe, se genera una y se muestra UNA vez.
 */
await runCli(async () => {
  const pool = createPool(databaseConfigFromEnv());
  const cipher = FieldCipher.fromEnv();
  const clock = new SystemClock();
  try {
    const result = await seedDemo(pool, cipher, clock);
    if (result.created) {
      const entries = await new PostgresDatabase(pool, cipher).repositories().ledger.entriesOf(result.organizationId);
      const summary = summarize(entries);
      console.log(`Demo creada: ${result.loans} préstamos y ${result.payments} pagos con recibo.`);
      console.log(`Caja:               ${summary.cash.format()}`);
      console.log(`Capital colocado:   ${summary.portfolio.format()}`);
      console.log(`Intereses ganados:  ${summary.interestIncome.format()}`);
    } else {
      const upgraded = await upgradeDemoLateFees(pool, cipher, clock);
      console.log(
        upgraded > 0
          ? `La demo ya existía: se asignó política de mora a ${upgraded} préstamo(s) y se calculó la mora de hoy.`
          : "La demo ya existía y está al día.",
      );
    }

    const applicants = await ensureDemoPrescreening(pool, cipher, clock);
    if (applicants > 0) {
      console.log(`Bandeja de precalificación: ${applicants} solicitantes de ejemplo. Enlace público: /aplicar/credito-inteligente-demo`);
    }

    const generated = !process.env.DEMO_PASSWORD;
    const password = process.env.DEMO_PASSWORD ?? randomBytes(9).toString("base64url");
    const createUser = new CreateUser({
      users: new PostgresUserRepository(pool),
      hasher: new ScryptPasswordHasher(),
      ids: new UuidV7Generator(),
    });
    const users = await ensureDemoUsers(pool, createUser, password);
    if (users.created.length > 0) {
      console.log("\nUsuarios de la demo creados:");
      for (const email of users.created) {
        console.log(`  ${email}`);
      }
      console.log(
        generated
          ? `Contraseña (anótala ahora, no se vuelve a mostrar): ${password}`
          : "Contraseña: la que definiste en DEMO_PASSWORD.",
      );
    } else {
      console.log("Los usuarios de la demo ya existen (no se cambió ninguna contraseña).");
    }
    console.log(`Organización demo: ${result.organizationId}`);
  } finally {
    await pool.end();
  }
});
