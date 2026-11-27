import { describe, expect, it } from "vitest";
import { formatBp, formatDate, formatDays, whatsappLink } from "./format";
import { bpToPercentInput, centsToInput, parseLempiras, parsePercentToBp } from "./money-input";

describe("parseLempiras", () => {
  it("convierte lo que escribe la persona en centavos exactos", () => {
    expect(parseLempiras("2,500.50")).toBe(250_050);
    expect(parseLempiras("2500")).toBe(250_000);
    expect(parseLempiras("L 1 250.5")).toBe(125_050);
    expect(parseLempiras("0.07")).toBe(7);
  });

  it("no pierde centavos por decimales de punto flotante", () => {
    expect(parseLempiras("19.99")).toBe(1999);
    expect(parseLempiras("1.15")).toBe(115);
  });

  it("rechaza lo que no es un monto", () => {
    for (const text of ["", "abc", "1.234", "-5", "1,2,x", "10.5.5"]) {
      expect(parseLempiras(text), text).toBeNull();
    }
  });

  it("ida y vuelta con centsToInput", () => {
    expect(parseLempiras(centsToInput(123_456))).toBe(123_456);
  });
});

describe("porcentajes", () => {
  it("convierte porcentaje en puntos base", () => {
    expect(parsePercentToBp("5")).toBe(500);
    expect(parsePercentToBp("5.25")).toBe(525);
    expect(parsePercentToBp("5,5 %")).toBe(550);
    expect(parsePercentToBp("abc")).toBeNull();
    expect(bpToPercentInput(525)).toBe("5.25");
  });
});

describe("formato", () => {
  it("muestra fechas y porcentajes en español", () => {
    expect(formatDate("2026-12-01")).toBe("1 dic 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatBp(1250)).toBe("12.5 %");
    expect(formatBp(1000)).toBe("10 %");
    expect(formatDays(1)).toBe("1 día");
    expect(formatDays(3)).toBe("3 días");
  });

  it("arma el enlace de WhatsApp con prefijo de Honduras y mensaje codificado", () => {
    const link = whatsappLink("9988-7766", "Hola María & familia");
    expect(link).toBe("https://wa.me/50499887766?text=Hola%20Mar%C3%ADa%20%26%20familia");
    expect(whatsappLink(null, "x")).toBeNull();
  });
});
