import {
  FixedPerDayLateFee,
  InvalidLateFeeInputError,
  NoLateFee,
  PercentOfOverdueLateFee,
  PercentPerDayLateFee,
  type LateFeePolicy,
} from "./late-fee";
import { Money } from "./money";

/**
 * Política de mora de un préstamo, guardada como datos (no como código) para que viaje con el
 * préstamo, se pueda mostrar en el contrato y siga igual aunque cambien las tarifas del negocio.
 */
export type LateFeeConfig =
  | { type: "NONE" }
  | { type: "PERCENT_OF_OVERDUE"; rateBp: number }
  | { type: "FIXED_PER_DAY"; amountCents: number }
  | { type: "PERCENT_PER_DAY"; rateBp: number };

export const NO_LATE_FEE: LateFeeConfig = { type: "NONE" };

/** Convierte la configuración guardada en la política que calcula la mora. */
export function lateFeePolicyFromConfig(config: LateFeeConfig): LateFeePolicy {
  switch (config.type) {
    case "NONE":
      return new NoLateFee();
    case "PERCENT_OF_OVERDUE":
      return new PercentOfOverdueLateFee(config.rateBp);
    case "FIXED_PER_DAY":
      return new FixedPerDayLateFee(Money.fromCents(config.amountCents));
    case "PERCENT_PER_DAY":
      return new PercentPerDayLateFee(config.rateBp);
  }
}

/** Verifica una configuración que viene de afuera (formulario o base de datos) y la devuelve limpia. */
export function parseLateFeeConfig(value: unknown): LateFeeConfig {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new InvalidLateFeeInputError("La política de mora no es válida");
  }
  const raw = value as { type: unknown; rateBp?: unknown; amountCents?: unknown };
  switch (raw.type) {
    case "NONE":
      return NO_LATE_FEE;
    case "PERCENT_OF_OVERDUE":
    case "PERCENT_PER_DAY":
      if (!Number.isInteger(raw.rateBp) || (raw.rateBp as number) < 0) {
        throw new InvalidLateFeeInputError("La tasa de mora debe ser un entero en puntos base");
      }
      return { type: raw.type, rateBp: raw.rateBp as number };
    case "FIXED_PER_DAY":
      if (!Number.isInteger(raw.amountCents) || (raw.amountCents as number) < 0) {
        throw new InvalidLateFeeInputError("El monto diario de mora debe ser un entero en centavos");
      }
      return { type: "FIXED_PER_DAY", amountCents: raw.amountCents as number };
    default:
      throw new InvalidLateFeeInputError("El tipo de política de mora no existe");
  }
}

/** Descripción para el contrato y la pantalla: "2 % del monto vencido", "L 25.00 por día"… */
export function describeLateFee(config: LateFeeConfig, graceDays: number): string {
  const grace = graceDays > 0 ? ` después de ${graceDays} día${graceDays === 1 ? "" : "s"} de gracia` : "";
  switch (config.type) {
    case "NONE":
      return "Sin mora";
    case "PERCENT_OF_OVERDUE":
      return `${formatPercent(config.rateBp)} del monto vencido${grace}`;
    case "FIXED_PER_DAY":
      return `${Money.fromCents(config.amountCents).format()} por cada día de atraso${grace}`;
    case "PERCENT_PER_DAY":
      return `${formatPercent(config.rateBp)} diario sobre el monto vencido${grace}`;
  }
}

function formatPercent(rateBp: number): string {
  const percent = rateBp / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)} %`;
}
