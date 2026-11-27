import { describe, expect, it } from "vitest";
import { SystemClock } from "./system-clock";

const at = (iso: string) => () => new Date(iso);

describe("SystemClock", () => {
  it("usa la fecha de Honduras (UTC-6), no la de UTC", () => {
    // 3 de la mañana UTC del 28 todavía es la noche del 27 en Tegucigalpa.
    expect(new SystemClock("America/Tegucigalpa", at("2026-11-28T03:00:00Z")).today()).toBe("2026-11-27");
    expect(new SystemClock("America/Tegucigalpa", at("2026-11-28T06:00:00Z")).today()).toBe("2026-11-28");
  });

  it("cambia de día a la medianoche local", () => {
    expect(new SystemClock("America/Tegucigalpa", at("2026-12-01T05:59:59Z")).today()).toBe("2026-11-30");
    expect(new SystemClock("America/Tegucigalpa", at("2026-12-01T06:00:00Z")).today()).toBe("2026-12-01");
  });

  it("respeta otra zona horaria", () => {
    expect(new SystemClock("Asia/Tokyo", at("2026-11-27T20:00:00Z")).today()).toBe("2026-11-28");
  });

  it("devuelve el formato AAAA-MM-DD con ceros", () => {
    expect(new SystemClock("America/Tegucigalpa", at("2027-01-05T12:00:00Z")).today()).toBe("2027-01-05");
  });

  it("sin reloj inyectado devuelve una fecha válida", () => {
    expect(new SystemClock().today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
