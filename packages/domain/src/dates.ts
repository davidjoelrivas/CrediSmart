const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

/** Suma días a una fecha AAAA-MM-DD (puede ser negativo). */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Suma meses a una fecha AAAA-MM-DD. Si el día no existe en el mes destino,
 * usa el último día de ese mes (31 de enero + 1 mes = 28 de febrero).
 */
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const lastDayOfTargetMonth = new Date(Date.UTC(year!, month! - 1 + months + 1, 0)).getUTCDate();
  const date = new Date(
    Date.UTC(year!, month! - 1 + months, Math.min(day!, lastDayOfTargetMonth)),
  );
  return date.toISOString().slice(0, 10);
}

/** Verdadero si el texto es una fecha real con el formato AAAA-MM-DD. */
export function isValidIsoDate(isoDate: string): boolean {
  return ISO_DATE_PATTERN.test(isoDate) && addDays(isoDate, 0) === isoDate;
}

/** Días completos de `from` a `to` (positivo si `to` es posterior). Ambas fechas deben ser válidas. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / MILLISECONDS_PER_DAY);
}
