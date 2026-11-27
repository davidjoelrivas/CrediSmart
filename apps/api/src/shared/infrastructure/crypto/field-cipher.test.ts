import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FieldCipher, FieldCipherError, generateKeyPair } from "./field-cipher";

const newCipher = () => new FieldCipher(randomBytes(32), randomBytes(32));

describe("FieldCipher: cifrado", () => {
  it("descifra exactamente lo que cifró, incluidos acentos y símbolos", () => {
    const cipher = newCipher();
    for (const text of ["0801-1990-12345", "", "José Ñandú — ¿Qué tal? 😀", "x".repeat(10_000)]) {
      expect(cipher.decrypt(cipher.encrypt(text))).toBe(text);
    }
  });

  it("cifrar dos veces lo mismo da resultados distintos, y no contiene el texto original", () => {
    const cipher = newCipher();
    const first = cipher.encrypt("0801-1990-12345");
    const second = cipher.encrypt("0801-1990-12345");

    expect(first.equals(second)).toBe(false);
    expect(first.toString("utf8")).not.toContain("0801");
  });

  it("detecta cualquier alteración del dato cifrado", () => {
    const cipher = newCipher();
    const encrypted = cipher.encrypt("dato sensible");

    for (const position of [0, 5, 20, encrypted.length - 1]) {
      const tampered = Buffer.from(encrypted);
      tampered[position] = tampered[position]! ^ 0xff;
      expect(() => cipher.decrypt(tampered)).toThrow(FieldCipherError);
    }
  });

  it("no descifra con otra llave ni con datos truncados", () => {
    const encrypted = newCipher().encrypt("dato sensible");

    expect(() => newCipher().decrypt(encrypted)).toThrow(FieldCipherError);
    expect(() => newCipher().decrypt(encrypted.subarray(0, 10))).toThrow(FieldCipherError);
  });
});

describe("FieldCipher: huella de búsqueda", () => {
  it("es estable y no distingue mayúsculas, espacios ni guiones", () => {
    const cipher = newCipher();
    expect(cipher.searchHash("0801-1990-12345")).toBe(cipher.searchHash("0801199012345"));
    expect(cipher.searchHash("ab-12 cd")).toBe(cipher.searchHash("AB12CD"));
    expect(cipher.searchHash("0801-1990-12345")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambia con otro dato y con otra llave", () => {
    const cipher = newCipher();
    expect(cipher.searchHash("111")).not.toBe(cipher.searchHash("112"));
    expect(newCipher().searchHash("111")).not.toBe(cipher.searchHash("111"));
  });
});

describe("FieldCipher: llaves", () => {
  it("se crea desde las variables de entorno", () => {
    const keys = generateKeyPair();
    const cipher = FieldCipher.fromEnv({ ...keys });
    expect(cipher.decrypt(cipher.encrypt("hola"))).toBe("hola");
  });

  it("avisa con claridad si falta una llave o tiene un tamaño incorrecto", () => {
    const keys = generateKeyPair();
    expect(() => FieldCipher.fromEnv({})).toThrow(/FIELD_ENCRYPTION_KEY/);
    expect(() => FieldCipher.fromEnv({ FIELD_ENCRYPTION_KEY: keys.FIELD_ENCRYPTION_KEY })).toThrow(/FIELD_HASH_KEY/);
    expect(() =>
      FieldCipher.fromEnv({ FIELD_ENCRYPTION_KEY: "corta", FIELD_HASH_KEY: keys.FIELD_HASH_KEY }),
    ).toThrow(/32 bytes/);
  });

  it("exige llaves distintas entre sí", () => {
    const key = randomBytes(32);
    expect(() => new FieldCipher(key, key)).toThrow(FieldCipherError);
  });

  it("las llaves generadas son distintas cada vez", () => {
    expect(generateKeyPair().FIELD_ENCRYPTION_KEY).not.toBe(generateKeyPair().FIELD_ENCRYPTION_KEY);
  });
});
