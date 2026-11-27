import type { Money } from "./money";

const UNITS = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
  "veintisiete", "veintiocho", "veintinueve",
];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/** 0-999 en palabras. */
function belowThousand(n: number): string {
  if (n === 0) {
    return "";
  }
  if (n === 100) {
    return "cien";
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) {
    parts.push(HUNDREDS[hundreds]!);
  }
  if (rest > 0) {
    if (rest < 30) {
      parts.push(UNITS[rest]!);
    } else {
      const tens = TENS[Math.floor(rest / 10)]!;
      const unit = rest % 10;
      parts.push(unit === 0 ? tens : `${tens} y ${UNITS[unit]}`);
    }
  }
  return parts.join(" ");
}

/** Entero no negativo hasta 999,999,999 en palabras (minúsculas): 21000 → "veintiún mil". */
export function integerInSpanish(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999_999_999) {
    throw new RangeError("Solo se admiten enteros entre 0 y 999,999,999");
  }
  if (value === 0) {
    return "cero";
  }
  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const rest = value % 1000;
  const parts: string[] = [];

  if (millions > 0) {
    parts.push(millions === 1 ? "un millón" : `${apocope(belowThousand(millions))} millones`);
  }
  if (thousands > 0) {
    parts.push(thousands === 1 ? "mil" : `${apocope(belowThousand(thousands))} mil`);
  }
  if (rest > 0) {
    parts.push(belowThousand(rest));
  }
  return parts.join(" ");
}

/** "uno" → "un" y "veintiuno" → "veintiún" cuando van antes de "mil" o "millones". */
function apocope(words: string): string {
  return words.replace(/veintiuno$/, "veintiún").replace(/\buno$/, "un");
}

/**
 * Monto en letras como se escribe en un pagaré: "DIEZ MIL LEMPIRAS CON 50/100".
 * La parte de centavos va siempre en número sobre 100.
 */
export function lempirasInWords(amount: Money): string {
  const cents = Math.abs(amount.toCents());
  const lempiras = Math.floor(cents / 100);
  const centavos = String(cents % 100).padStart(2, "0");
  const words = integerInSpanish(lempiras);
  const currency = lempiras === 1 ? "lempira" : lempiras % 1_000_000 === 0 && lempiras > 0 ? "de lempiras" : "lempiras";
  return `${words} ${currency} con ${centavos}/100`.toUpperCase();
}
