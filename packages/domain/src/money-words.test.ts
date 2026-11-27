import { describe, expect, it } from "vitest";
import { integerInSpanish, lempirasInWords } from "./money-words";
import { Money } from "./money";

describe("integerInSpanish", () => {
  it.each([
    [0, "cero"],
    [1, "uno"],
    [15, "quince"],
    [21, "veintiuno"],
    [30, "treinta"],
    [42, "cuarenta y dos"],
    [100, "cien"],
    [101, "ciento uno"],
    [500, "quinientos"],
    [999, "novecientos noventa y nueve"],
    [1000, "mil"],
    [1001, "mil uno"],
    [2750, "dos mil setecientos cincuenta"],
    [10_000, "diez mil"],
    [21_000, "veintiún mil"],
    [31_000, "treinta y un mil"],
    [100_000, "cien mil"],
    [150_000, "ciento cincuenta mil"],
    [1_000_000, "un millón"],
    [2_500_000, "dos millones quinientos mil"],
    [21_000_000, "veintiún millones"],
  ])("%i → %s", (value, words) => {
    expect(integerInSpanish(value)).toBe(words);
  });

  it("rechaza lo que no puede escribir", () => {
    expect(() => integerInSpanish(-1)).toThrow(RangeError);
    expect(() => integerInSpanish(1.5)).toThrow(RangeError);
    expect(() => integerInSpanish(1_000_000_000)).toThrow(RangeError);
  });
});

describe("lempirasInWords", () => {
  it("escribe el monto como en un pagaré", () => {
    expect(lempirasInWords(Money.fromLempiras("10000"))).toBe("DIEZ MIL LEMPIRAS CON 00/100");
    expect(lempirasInWords(Money.fromLempiras("2750.50"))).toBe("DOS MIL SETECIENTOS CINCUENTA LEMPIRAS CON 50/100");
    expect(lempirasInWords(Money.fromLempiras("1"))).toBe("UNO LEMPIRA CON 00/100");
    expect(lempirasInWords(Money.fromLempiras("0.05"))).toBe("CERO LEMPIRAS CON 05/100");
    expect(lempirasInWords(Money.fromLempiras("1000000"))).toBe("UN MILLÓN DE LEMPIRAS CON 00/100");
  });
});
