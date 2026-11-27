export interface AuditRecord {
  organizationId: string;
  actorId: string;
  /** Qué ocurrió, por ejemplo LOAN_APPROVED. */
  action: string;
  entity: string;
  entityId: string;
  /** Fecha del hecho (AAAA-MM-DD). */
  on: string;
  /** Datos relevantes del cambio, para poder explicarlo después. */
  details: Readonly<Record<string, string | number | boolean | null>>;
}

/** Bitácora de operaciones importantes: solo se agregan registros. */
export interface AuditLog {
  record(entry: AuditRecord): Promise<void>;
  recordsOf(organizationId: string): Promise<AuditRecord[]>;
}
