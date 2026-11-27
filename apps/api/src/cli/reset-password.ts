import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { InvalidUserError, normalizeEmail, validatePassword } from "../modules/identity/domain/user";
import { PostgresSessionRepository, PostgresUserRepository } from "../modules/identity/infrastructure/postgres/postgres-identity-repositories";
import { ScryptPasswordHasher } from "../modules/identity/infrastructure/scrypt-password-hasher";
import { createPool, databaseConfigFromEnv } from "../shared/infrastructure/postgres/connection";
import { runCli } from "./run-cli";

const USAGE = `Uso: pnpm --filter @app/api users:reset-password -- --email correo@ejemplo.com

Cambia la contraseña de una cuenta, cierra todas sus sesiones y la desbloquea.
La nueva contraseña sale de USER_PASSWORD; si no la defines, se genera una segura.`;

await runCli(async () => {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  if (!values.email) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  const email = normalizeEmail(values.email);
  const generated = !process.env.USER_PASSWORD;
  const password = process.env.USER_PASSWORD ?? randomBytes(12).toString("base64url");
  validatePassword(password, email);

  const pool = createPool(databaseConfigFromEnv());
  try {
    const users = new PostgresUserRepository(pool);
    const user = await users.findByLogin({ email });
    if (!user) {
      throw new InvalidUserError(`No existe ninguna cuenta con el correo ${email}`);
    }
    await users.setPasswordHash(user.id, await new ScryptPasswordHasher().hash(password));
    await new PostgresSessionRepository(pool).revokeAllOfUser(user.id, new Date());
    console.log(`Contraseña cambiada para ${user.fullName}. Sus sesiones abiertas se cerraron.`);
    if (generated) {
      console.log(`Nueva contraseña (anótala ahora, no se vuelve a mostrar): ${password}`);
    }
  } finally {
    await pool.end();
  }
});
