/**
 * Convierte lo que escribe la persona ("2,500.50", "2500", "L 2 500") en centavos enteros.
 * Devuelve null si no es un monto válido. Nunca usa decimales de punto flotante para el dinero.
 */
export function parseLempiras(text: string): number | null {
  const cleaned = text.replace(/[L\s,]/gi, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    return null;
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Centavos → texto editable sin símbolo: 250050 → "2500.50". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** "5" o "5.5" (por ciento) → puntos base (500, 550). Null si no es válido. */
export function parsePercentToBp(text: string): number | null {
  const cleaned = text.replace(/[%\s]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  return Math.round(Number(cleaned) * 100);
}

export function bpToPercentInput(basisPoints: number): string {
  return (basisPoints / 100).toString();
}
