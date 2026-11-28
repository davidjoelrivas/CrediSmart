import type { AuditLog, AuditRecord } from "../../application/ports";
import {
  asNumber,
  asString,
  runStatement,
  selectRows,
  type Executor,
} from "../../../../shared/infrastructure/postgres/sql";
import {
  computeAuditHash,
  GENESIS_HASH,
  verifyAuditChain,
  type ChainVerification,
  type StoredAuditRow,
} from "../audit-chain";

/**
 * Bitácora con cadena de hashes. Cada registro nuevo bloquea la cabeza de la cadena de su
 * organización dentro de la transacción, así que los registros se encadenan siempre en orden.
 */
export class PostgresAuditLog implements AuditLog {
  constructor(private readonly db: Executor) {}

  async record(entry: AuditRecord): Promise<void> {
    await runStatement(
      this.db,
      `INSERT INTO audit_chain_heads (organization_id, last_seq, last_hash) VALUES ($1, 0, $2)
       ON CONFLICT (organization_id) DO NOTHING`,
      [entry.organizationId, GENESIS_HASH],
    );
    const [head] = await selectRows(
      this.db,
      "SELECT last_seq, last_hash FROM audit_chain_heads WHERE organization_id = $1 FOR UPDATE",
      [entry.organizationId],
    );
    const sequence = asNumber(head!.last_seq) + 1;
    const previousHash = asString(head!.last_hash);
    const rowHash = computeAuditHash(previousHash, sequence, entry);

    await runStatement(
      this.db,
      `INSERT INTO audit_log
         (organization_id, seq, actor_id, action, entity, entity_id, event_on, details, prev_hash, row_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.organizationId,
        sequence,
        entry.actorId,
        entry.action,
        entry.entity,
        entry.entityId,
        entry.on,
        JSON.stringify(entry.details),
        previousHash,
        rowHash,
      ],
    );
    await runStatement(
      this.db,
      "UPDATE audit_chain_heads SET last_seq = $1, last_hash = $2 WHERE organization_id = $3",
      [sequence, rowHash, entry.organizationId],
    );
  }

  async recordsOf(organizationId: string): Promise<AuditRecord[]> {
    return (await this.storedRows(organizationId)).map((row) => row.record);
  }

  /** Recorre la cadena de la organización y avisa si algún registro fue alterado. */
  async verifyChain(organizationId: string): Promise<ChainVerification> {
    return verifyAuditChain(await this.storedRows(organizationId));
  }

  private async storedRows(organizationId: string): Promise<StoredAuditRow[]> {
    const rows = await selectRows(
      this.db,
      `SELECT seq, actor_id, action, entity, entity_id, event_on, details, prev_hash, row_hash
       FROM audit_log WHERE organization_id = $1 ORDER BY seq`,
      [organizationId],
    );
    return rows.map((row) => ({
      sequence: asNumber(row.seq),
      previousHash: asString(row.prev_hash),
      rowHash: asString(row.row_hash),
      record: {
        organizationId,
        actorId: asString(row.actor_id),
        action: asString(row.action),
        entity: asString(row.entity),
        entityId: asString(row.entity_id),
        on: asString(row.event_on),
        details: row.details as AuditRecord["details"],
      },
    }));
  }
}
