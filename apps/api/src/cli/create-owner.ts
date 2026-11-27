import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { CreateUser } from "../modules/identity/application/create-user";
import { PostgresUserRepository } from "../modules/identity/infrastructure/postgres/postgres-identity-repositories";
import { ScryptPasswordHasher } from "../modules/identity/infrastructure/scrypt-password-hasher";
import { createPool, databaseConfigFromEnv } from "../shared/infrastructure/postgres/connection";
import { runStatement, selectRows } from "../shared/infrastructure/postgres/sql";
import { newUuidV7, UuidV7Generator } from "../shared/infrastructure/postgres/uuid";
import { runCli } from "./run-cli";

const USAGE = `Uso: pnpm --filter @app/api users:create -- --org "Crédito Inteligente" --name "Mauricio Mejía" --email correo@ejemplo.com [--role OWNER] [--phone 99887766]

Crea la organización (si no existe) y una cuenta de acceso. La contraseña sale de la variable USER_PASSWORD;
si no la defines, se genera una segura y se muestra una sola vez.`;

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      org: { type: "string" },
      name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      role: { type: "string", default: "OWNER" },
    },
  });
  if (!values.org || !values.name || (!values.email && !values.phone)) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  const role = values.role;
  if (role !== "OWNER" && role !== "COLLECTOR" && role !== "ACCOUNTANT") {
    throw new Error("El rol debe ser OWNER, COLLECTOR o ACCOUNTANT");
  }

  const pool = createPool(databaseConfigFromEnv());
  try {
    const [existing] = await selectRows(pool, "SELECT id FROM organizations WHERE name = $1", [values.org]);
    const organizationId = existing ? String(existing.id) : newUuidV7();
    if (!existing) {
      await runStatement(pool, "INSERT INTO organizations (id, name) VALUES ($1, $2)", [organizationId, values.org]);
      console.log(`Organización creada: ${values.org}`);
    }

    const generated = !process.env.USER_PASSWORD;
    const password = process.env.USER_PASSWORD ?? randomBytes(12).toString("base64url");
    const user = await new CreateUser({
      users: new PostgresUserRepository(pool),
      hasher: new ScryptPasswordHasher(),
      ids: new UuidV7Generator(),
    }).execute({
      organizationId,
      role,
      fullName: values.name,
      email: values.email,
      phone: values.phone,
      password,
    });
    console.log(`Usuario creado: ${user.fullName} (${role}) — ${user.email ?? user.phone}`);
    if (generated) {
      console.log(`Contraseña (anótala ahora, no se vuelve a mostrar): ${password}`);
    }
  } finally {
    await pool.end();
  }
});
