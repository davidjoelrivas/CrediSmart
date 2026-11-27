import { describe, expect, it } from "vitest";
import { RandomVerificationCodes } from "./random-verification-codes";

describe("RandomVerificationCodes", () => {
  const generator = new RandomVerificationCodes();

  it("genera 24 caracteres sin letras ni números ambiguos", () => {
    for (let index = 0; index < 200; index++) {
      expect(generator.newCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{24}$/);
    }
  });

  it("no repite códigos", () => {
    const codes = new Set(Array.from({ length: 5_000 }, () => generator.newCode()));
    expect(codes.size).toBe(5_000);
  });
});
