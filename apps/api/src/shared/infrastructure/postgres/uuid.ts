import { randomBytes } from "node:crypto";
import type { IdGenerator } from "../../application/ports";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** UUID versión 7: empieza con la hora, así que los ids nuevos quedan al final del índice de la tabla. */
export function newUuidV7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(now);
  for (let index = 0; index < 6; index++) {
    bytes[index] = Number((timestamp >> BigInt(8 * (5 - index))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class UuidV7Generator implements IdGenerator {
  newId(): string {
    return newUuidV7();
  }
}
