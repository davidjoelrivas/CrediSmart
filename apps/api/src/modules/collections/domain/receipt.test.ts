import { describe, expect, it } from "vitest";
import { formatReceiptFolio } from "./receipt";

describe("formatReceiptFolio", () => {
  it("rellena con ceros hasta 6 dígitos", () => {
    expect(formatReceiptFolio(1)).toBe("REC-000001");
    expect(formatReceiptFolio(123)).toBe("REC-000123");
  });

  it("no recorta folios más largos", () => {
    expect(formatReceiptFolio(1_234_567)).toBe("REC-1234567");
  });
});
