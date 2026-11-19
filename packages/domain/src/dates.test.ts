import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, isValidIsoDate } from "./dates";

describe("addDays", () => {
  it("cruza el cambio de mes y de año", () => {
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("respeta los años bisiestos", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("permite restar días y sumar cero", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-03-01", 0)).toBe("2026-03-01");
  });
});

describe("addMonths", () => {
  it("ajusta al último día del mes cuando el día no existe", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("mantiene el día cuando existe y cruza el año", () => {
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonths("2026-12-01", 12)).toBe("2027-12-01");
  });
});

describe("isValidIsoDate", () => {
  it("acepta fechas reales", () => {
    expect(isValidIsoDate("2026-12-01")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
  });

  it("rechaza formatos incorrectos y fechas inexistentes", () => {
    for (const text of ["", "01/12/2026", "2026-1-5", "2026-13-01", "2026-02-30", "2027-02-29"]) {
      expect(isValidIsoDate(text)).toBe(false);
    }
  });
});

describe("daysBetween", () => {
  it("cuenta los días entre dos fechas", () => {
    expect(daysBetween("2026-12-01", "2026-12-01")).toBe(0);
    expect(daysBetween("2026-12-01", "2026-12-11")).toBe(10);
    expect(daysBetween("2026-12-25", "2027-01-04")).toBe(10);
  });

  it("devuelve negativo cuando la segunda fecha es anterior", () => {
    expect(daysBetween("2026-12-11", "2026-12-01")).toBe(-10);
  });

  it("cuenta el día extra de un año bisiesto", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
  });
});
