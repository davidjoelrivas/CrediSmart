const CENTS_PER_UNIT = 100n;
const BASIS_POINTS_PER_UNIT = 10_000n;
const DECIMAL_AMOUNT_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

/** Divide y redondea al entero más cercano; los empates se alejan de cero (half-up). */
function divideRoundingHalfUp(numerator: bigint, denominator: bigint): bigint {
  const isNegative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * absNumerator + absDenominator) / (2n * absDenominator);
  return isNegative ? -quotient : quotient;
}

function toSafeCents(value: bigint): number {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents)) {
    throw new InvalidMoneyError("El monto excede el rango permitido");
  }
  return cents;
}

/**
 * Dinero en centavos enteros. Inmutable: cada operación devuelve un valor nuevo.
 * Nunca usa decimales de punto flotante.
 */
export class Money {
  private constructor(private readonly cents: number) {}

  static zero(): Money {
    return new Money(0);
  }

  static fromCents(cents: number): Money {
    if (!Number.isSafeInteger(cents)) {
      throw new InvalidMoneyError("Los centavos deben ser un entero seguro");
    }
    return new Money(cents);
  }

  /** Lee un monto como "1250.50" (hasta 2 decimales, sin separador de miles). */
  static fromLempiras(text: string): Money {
    const match = DECIMAL_AMOUNT_PATTERN.exec(text.trim());
    if (!match) {
      throw new InvalidMoneyError(`Monto inválido: "${text}"`);
    }
    const [, sign, whole, fraction = ""] = match;
    const absoluteCents =
      BigInt(whole as string) * CENTS_PER_UNIT + BigInt(fraction.padEnd(2, "0"));
    return new Money(toSafeCents(sign === "-" ? -absoluteCents : absoluteCents));
  }

  toCents(): number {
    return this.cents;
  }

  add(other: Money): Money {
    return Money.fromCents(this.cents + other.cents);
  }

  subtract(other: Money): Money {
    return Money.fromCents(this.cents - other.cents);
  }

  negate(): Money {
    return Money.fromCents(-this.cents);
  }

  /** Aplica una tasa en puntos base (2000 = 20 %), redondeando half-up al centavo. */
  multiplyByBasisPoints(basisPoints: number): Money {
    if (!Number.isSafeInteger(basisPoints)) {
      throw new InvalidMoneyError("La tasa debe ser un entero en puntos base");
    }
    const result = divideRoundingHalfUp(
      BigInt(this.cents) * BigInt(basisPoints),
      BASIS_POINTS_PER_UNIT,
    );
    return new Money(toSafeCents(result));
  }

  /**
   * Reparte el monto en partes casi iguales sin perder centavos:
   * las primeras n-1 se redondean y la última absorbe la diferencia.
   */
  splitEvenly(parts: number): Money[] {
    if (!Number.isSafeInteger(parts) || parts < 1) {
      throw new InvalidMoneyError("Las partes deben ser un entero mayor o igual a 1");
    }
    const share = toSafeCents(divideRoundingHalfUp(BigInt(this.cents), BigInt(parts)));
    const result = Array.from({ length: parts - 1 }, () => new Money(share));
    result.push(new Money(this.cents - share * (parts - 1)));
    return result;
  }

  compareTo(other: Money): -1 | 0 | 1 {
    if (this.cents === other.cents) return 0;
    return this.cents < other.cents ? -1 : 1;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  /** Texto para mostrar, por ejemplo "L 1,250.50". */
  format(): string {
    const absolute = Math.abs(this.cents);
    const whole = Math.floor(absolute / 100)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = (absolute % 100).toString().padStart(2, "0");
    return `${this.cents < 0 ? "-" : ""}L ${whole}.${fraction}`;
  }
}
