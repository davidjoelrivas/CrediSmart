/** Nombre del archivo de respaldo, con fecha y hora: credit-smart-2026-11-27-1830.dump */
export function backupFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `credit-smart-${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}.dump`
  );
}

/**
 * Argumentos de pg_dump para un respaldo completo y restaurable: formato comprimido, sin dueños ni
 * permisos específicos del servidor de origen. La contraseña va dentro de la URL de conexión.
 */
export function buildDumpArguments(databaseUrl: string, outputFile: string): string[] {
  return ["--format=custom", "--no-owner", "--no-privileges", `--file=${outputFile}`, `--dbname=${databaseUrl}`];
}
