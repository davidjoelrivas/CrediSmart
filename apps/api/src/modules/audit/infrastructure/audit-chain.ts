import { createHash } from "node:crypto";
import type { AuditRecord } from "../application/ports";

/** Hash con el que empieza la cadena de cada organización. */
export const GENESIS_HASH = "0".repeat(64);

/** JSON con las llaves ordenadas, para que el mismo contenido siempre produzca el mismo texto. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hash de un registro: depende de su contenido y del hash del registro anterior. */
export function computeAuditHash(previousHash: string, sequence: number, record: AuditRecord): string {
  const content = canonicalJson([
    previousHash,
    sequence,
    record.organizationId,
    record.actorId,
    record.action,
    record.entity,
    record.entityId,
    record.on,
    record.details,
  ]);
  return createHash("sha256").update(content).digest("hex");
}

export interface StoredAuditRow {
  sequence: number;
  previousHash: string;
  rowHash: string;
  record: AuditRecord;
}

export interface ChainVerification {
  valid: boolean;
  /** Primer número de secuencia donde la cadena se rompe. */
  brokenAtSequence?: number;
}

/** Recorre la cadena y comprueba que cada registro mantiene su hash y apunta al anterior. */
export function verifyAuditChain(rows: readonly StoredAuditRow[]): ChainVerification {
  let expectedPrevious = GENESIS_HASH;
  let expectedSequence = 1;
  for (const row of rows) {
    const recomputed = computeAuditHash(row.previousHash, row.sequence, row.record);
    if (
      row.sequence !== expectedSequence ||
      row.previousHash !== expectedPrevious ||
      row.rowHash !== recomputed
    ) {
      return { valid: false, brokenAtSequence: row.sequence };
    }
    expectedPrevious = row.rowHash;
    expectedSequence += 1;
  }
  return { valid: true };
}
