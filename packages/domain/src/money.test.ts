import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { InvalidMoneyError, Money } from "./money";

describe("Money: creación", () => {
  it("guarda el monto en centavos enteros", () => {
    expect(Money.fromCents(125050).toCents()).toBe(125050);
  });

  it("rechaza decimales y valores no finitos", () => {
    expect(() => Money.fromCents(10.5)).toThrow(InvalidMoneyError);
    expect(() => Money.fromCents(Number.NaN)).toThrow(InvalidMoneyError);
    expect(() => Money.fromCents(Number.POSITIVE_INFINITY)).toThrow(InvalidMoneyError);
  });

  it("rechaza enteros fuera del rango seguro", () => {
    expect(() => Money.fromCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidMoneyError);
  });

  it("lee lempiras con 0, 1 o 2 decimales", () => {
    expect(Money.fromLempiras("1250.50").toCents()).toBe(125050);
    expect(Money.fromLempiras("1250.5").toCents()).toBe(125050);
    expect(Money.fromLempiras("1250").toCents()).toBe(125000);
    expect(Money.fromLempiras("0.05").toCents()).toBe(5);
    expect(Money.fromLempiras("-10.25").toCents()).toBe(-1025);
  });

  it("rechaza textos inválidos o con más de 2 decimales", () => {
    for (const text of ["", "abc", "12.345", "1,250.50", "12.", ".5", "--3"]) {
      expect(() => Money.fromLempiras(text)).toThrow(InvalidMoneyError);
    }
  });
});

describe("Money: sumas y restas", () => {
  it("suma y resta sin errores de decimales", () => {
    const tenCents = Money.fromCents(10);
    const twentyCents = Money.fromCents(20);
    expect(tenCents.add(twentyCents).toCents()).toBe(30);
    expect(twentyCents.subtract(tenCents).toCents()).toBe(10);
  });

  it("no modifica los valores originales", () => {
    const original = Money.fromCents(500);
    original.add(Money.fromCents(100));
    expect(original.toCents()).toBe(500);
  });

  it("permite resultados negativos y los reconoce", () => {
    const result = Money.fromCents(100).subtract(Money.fromCents(250));
    expect(result.toCents()).toBe(-150);
    expect(result.isNegative()).toBe(true);
    expect(result.negate().toCents()).toBe(150);
  });
});

describe("Money: tasas en puntos base", () => {
  it("calcula el 20 % de L 10,000.00", () => {
    expect(Money.fromLempiras("10000").multiplyByBasisPoints(2000).toCents()).toBe(200000);
  });

  it("redondea half-up al centavo", () => {
    // 5 % de 0.10 = 0.005 -> 0.01
    expect(Money.fromCents(10).multiplyByBasisPoints(500).toCents()).toBe(1);
    // 5 % de 0.09 = 0.0045 -> 0.00
    expect(Money.fromCents(9).multiplyByBasisPoints(500).toCents()).toBe(0);
  });

  it("redondea los empates negativos alejándose de cero", () => {
    expect(Money.fromCents(-10).multiplyByBasisPoints(500).toCents()).toBe(-1);
  });

  it("no pierde precisión con montos grandes", () => {
    const large = Money.fromCents(9_000_000_000_000);
    expect(large.multiplyByBasisPoints(10_000).toCents()).toBe(9_000_000_000_000);
  });

  it("rechaza tasas no enteras", () => {
    expect(() => Money.fromCents(100).multiplyByBasisPoints(12.5)).toThrow(InvalidMoneyError);
  });
});

describe("Money: proporciones", () => {
  it("calcula un tercio y dos tercios con redondeo half-up", () => {
    expect(Money.fromCents(100).multiplyByRatio(1, 3).toCents()).toBe(33);
    expect(Money.fromCents(100).multiplyByRatio(2, 3).toCents()).toBe(67);
  });

  it("redondea el empate hacia arriba", () => {
    expect(Money.fromCents(5).multiplyByRatio(1, 2).toCents()).toBe(3);
  });

  it("mantiene el signo en montos negativos", () => {
    expect(Money.fromCents(-100).multiplyByRatio(2, 3).toCents()).toBe(-67);
  });

  it("rechaza denominadores no positivos y valores no enteros", () => {
    expect(() => Money.fromCents(100).multiplyByRatio(1, 0)).toThrow(InvalidMoneyError);
    expect(() => Money.fromCents(100).multiplyByRatio(1, -2)).toThrow(InvalidMoneyError);
    expect(() => Money.fromCents(100).multiplyByRatio(1.5, 2)).toThrow(InvalidMoneyError);
  });
});

describe("Money: reparto en partes", () => {
  it("reparte L 100.00 en 3 partes y la última absorbe la diferencia", () => {
    const parts = Money.fromCents(10000).splitEvenly(3).map((part) => part.toCents());
    expect(parts).toEqual([3333, 3333, 3334]);
  });

  it("reparte en 1 parte devolviendo el mismo monto", () => {
    expect(Money.fromCents(777).splitEvenly(1).map((part) => part.toCents())).toEqual([777]);
  });

  it("rechaza repartos en 0 partes o con decimales", () => {
    expect(() => Money.fromCents(100).splitEvenly(0)).toThrow(InvalidMoneyError);
    expect(() => Money.fromCents(100).splitEvenly(2.5)).toThrow(InvalidMoneyError);
  });

  it("propiedad: las partes siempre suman el total exacto", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 120 }),
        (cents, parts) => {
          const split = Money.fromCents(cents).splitEvenly(parts);
          const total = split.reduce((sum, part) => sum.add(part), Money.zero());
          expect(split).toHaveLength(parts);
          expect(total.toCents()).toBe(cents);
        },
      ),
    );
  });
});

describe("Money: comparación y formato", () => {
  it("compara y detecta cero", () => {
    expect(Money.fromCents(5).compareTo(Money.fromCents(9))).toBe(-1);
    expect(Money.fromCents(9).compareTo(Money.fromCents(5))).toBe(1);
    expect(Money.fromCents(5).compareTo(Money.fromCents(5))).toBe(0);
    expect(Money.fromCents(5).equals(Money.fromCents(5))).toBe(true);
    expect(Money.zero().isZero()).toBe(true);
  });

  it("formatea con separador de miles y 2 decimales", () => {
    expect(Money.fromCents(125050).format()).toBe("L 1,250.50");
    expect(Money.fromCents(5).format()).toBe("L 0.05");
    expect(Money.fromCents(100000000).format()).toBe("L 1,000,000.00");
    expect(Money.fromCents(-1025).format()).toBe("-L 10.25");
  });
});
