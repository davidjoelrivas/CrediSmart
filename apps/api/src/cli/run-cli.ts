import { describeConnectionError } from "../shared/infrastructure/postgres/connection";

/** Ejecuta un comando y, si falla, muestra un mensaje claro en vez del error técnico completo. */
export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(`\nError: ${describeConnectionError(error)}`);
    process.exitCode = 1;
  }
}
