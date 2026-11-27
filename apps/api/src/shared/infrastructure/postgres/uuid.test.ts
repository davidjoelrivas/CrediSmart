import { describe, expect, it } from "vitest";
import { isUuid, newUuidV7, UuidV7Generator } from "./uuid";

describe("newUuidV7", () => {
  it("tiene el formato de UUID versión 7", () => {
    const uuid = newUuidV7();
    expect(isUuid(uuid)).toBe(true);
    expect(uuid[14]).toBe("7");
    expect("89ab").toContain(uuid[19]);
  });

  it("empieza con la hora: ids creados más tarde ordenan después", () => {
    const earlier = newUuidV7(1_700_000_000_000);
    const later = newUuidV7(1_700_000_005_000);
    expect(earlier < later).toBe(true);
  });

  it("no repite valores", () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => newUuidV7()));
    expect(ids.size).toBe(5_000);
  });

  it("el generador de ids devuelve UUIDs válidos", () => {
    expect(isUuid(new UuidV7Generator().newId())).toBe(true);
  });
});

describe("isUuid", () => {
  it("rechaza textos que no son UUID", () => {
    expect(isUuid("org-1")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
