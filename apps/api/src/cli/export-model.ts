import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEMO_ORGANIZATION_ID } from "../demo/seed-demo";
import { createPool, databaseConfigFromEnv } from "../shared/infrastructure/postgres/connection";
import { exportDataModel, exportOrganizationData } from "../shared/infrastructure/postgres/schema-export";
import { runCli } from "./run-cli";

const USAGE = `Uso: pnpm --filter @app/api db:export-model [-- --out ruta.json] [--datos] [--org ID]

Exporta el modelo de datos REAL (tablas, columnas, llaves, índices, triggers) a un archivo JSON.
Con --datos agrega también las filas de una organización (por defecto la demo), sin contraseñas, tokens ni datos cifrados.`;

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: "../../docs/modelo-de-datos.json" },
      datos: { type: "boolean", default: false },
      org: { type: "string", default: DEMO_ORGANIZATION_ID },
      ayuda: { type: "boolean", default: false },
    },
  });
  if (values.ayuda) {
    console.log(USAGE);
    return;
  }

  const pool = createPool(databaseConfigFromEnv());
  try {
    const model = await exportDataModel(pool);
    const document = values.datos
      ? { ...model, organizationId: values.org, data: await exportOrganizationData(pool, values.org) }
      : model;
    const target = resolve(values.out);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    console.log(`Modelo exportado: ${model.tables.length} tablas, ${model.migrations.length} migraciones → ${target}`);
  } finally {
    await pool.end();
  }
});
