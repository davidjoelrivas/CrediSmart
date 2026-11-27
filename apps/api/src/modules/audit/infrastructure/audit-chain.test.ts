import { describe, expect, it } from "vitest";
import type { AuditRecord } from "../application/ports";
import {
  canonicalJson,
  computeAuditHash,
  GENESIS_HASH,
  verifyAuditChain,
  type StoredAuditRow,
} from "./audit-chain";

function recordOf(action: string, details: AuditRecord["details"] = {}): AuditRecord {
  return {
    organizationId: "org-1",
    actorId: "owner-1",
    action,
    entity: "loan",
    entityId: "loan-1",
    on: "2026-12-01",
    details,
  };
}

function chainOf(...records: AuditRecord[]): StoredAuditRow[] {
  const rows: StoredAuditRow[] = [];
  let previousHash = GENESIS_HASH;
  records.forEach((record, index) => {
    const sequence = index + 1;
    const rowHash = computeAuditHash(previousHash, sequence, record);
    rows.push({ sequence, previousHash, rowHash, record });
    previousHash = rowHash;
  });
  return rows;
}

describe("canonicalJson", () => {
  it("ordena las llaves, así el mismo contenido da siempre el mismo texto", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("conserva el orden de las listas y distingue valores", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({ a: false }));
  });
});

describe("computeAuditHash", () => {
  it("es determinista y cambia si cambia cualquier dato", () => {
    const base = computeAuditHash(GENESIS_HASH, 1, recordOf("LOAN_APPROVED", { amountCents: 100 }));
    expect(computeAuditHash(GENESIS_HASH, 1, recordOf("LOAN_APPROVED", { amountCents: 100 }))).toBe(base);
    expect(computeAuditHash(GENESIS_HASH, 1, recordOf("LOAN_APPROVED", { amountCents: 101 }))).not.toBe(base);
    expect(computeAuditHash(GENESIS_HASH, 2, recordOf("LOAN_APPROVED", { amountCents: 100 }))).not.toBe(base);
    expect(computeAuditHash("1".repeat(64), 1, recordOf("LOAN_APPROVED", { amountCents: 100 }))).not.toBe(base);
  });

  it("produce 64 caracteres hexadecimales", () => {
    expect(computeAuditHash(GENESIS_HASH, 1, recordOf("X"))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyAuditChain", () => {
  it("acepta una cadena íntegra y una vacía", () => {
    expect(verifyAuditChain(chainOf(recordOf("A"), recordOf("B"), recordOf("C")))).toEqual({ valid: true });
    expect(verifyAuditChain([])).toEqual({ valid: true });
  });

  it("detecta un registro alterado", () => {
    const rows = chainOf(recordOf("A", { amountCents: 100 }), recordOf("B"), recordOf("C"));
    rows[1] = { ...rows[1]!, record: recordOf("B", { amountCents: 999 }) };

    expect(verifyAuditChain(rows)).toEqual({ valid: false, brokenAtSequence: 2 });
  });

  it("detecta un registro eliminado de la mitad", () => {
    const rows = chainOf(recordOf("A"), recordOf("B"), recordOf("C"));

    expect(verifyAuditChain([rows[0]!, rows[2]!]).valid).toBe(false);
  });

  it("detecta registros reordenados", () => {
    const rows = chainOf(recordOf("A"), recordOf("B"));

    expect(verifyAuditChain([rows[1]!, rows[0]!]).valid).toBe(false);
  });

  it("detecta una cadena que no empieza desde el origen", () => {
    const rows = chainOf(recordOf("A"), recordOf("B"));

    expect(verifyAuditChain([rows[1]!]).valid).toBe(false);
  });
});
