import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { PasswordHasher } from "../application/ports";

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export interface ScryptParameters {
  /** Costo de CPU y memoria (potencia de 2). Más alto = más difícil de atacar por fuerza bruta. */
  cost: number;
  blockSize: number;
  parallelization: number;
}

/** 2^15 es un equilibrio razonable para un servidor pequeño (OWASP recomienda 2^17 si hay memoria). */
export const DEFAULT_SCRYPT: ScryptParameters = { cost: 32768, blockSize: 8, parallelization: 1 };

function derive(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  const options: ScryptOptions = {
    N: parameters.cost,
    r: parameters.blockSize,
    p: parameters.parallelization,
    maxmem: 256 * parameters.cost * parameters.blockSize,
  };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Contraseñas con scrypt (viene incluido en Node: no hay librerías nativas que compilar).
 * Formato guardado: scrypt$N$r$p$sal$hash. Cada contraseña lleva su propia sal aleatoria.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  constructor(private readonly parameters: ScryptParameters = DEFAULT_SCRYPT) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, this.parameters);
    const { cost, blockSize, parallelization } = this.parameters;
    return `scrypt$${cost}$${blockSize}$${parallelization}$${salt.toString("base64")}$${key.toString("base64")}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") {
      return false;
    }
    const [, cost, blockSize, parallelization, salt, expected] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const expectedKey = Buffer.from(expected, "base64");
    const key = await derive(password, Buffer.from(salt, "base64"), {
      cost: Number(cost),
      blockSize: Number(blockSize),
      parallelization: Number(parallelization),
    });
    return key.length === expectedKey.length && timingSafeEqual(key, expectedKey);
  }

  async burn(password: string): Promise<void> {
    await derive(password, randomBytes(SALT_LENGTH), this.parameters);
  }
}
