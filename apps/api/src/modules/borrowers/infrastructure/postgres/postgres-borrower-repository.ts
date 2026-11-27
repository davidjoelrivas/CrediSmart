import type { FieldCipher } from "../../../../shared/infrastructure/crypto/field-cipher";
import {
  asNullableString,
  asString,
  runStatement,
  selectRows,
  type Executor,
  type Row,
} from "../../../../shared/infrastructure/postgres/sql";
import type { BorrowerRepository, BorrowerSearch } from "../../application/ports";
import type { Borrower, BorrowerStatus } from "../../domain/borrower";

const COLUMNS = `id, organization_id, full_name, national_id_enc, phone, address, status,
  to_char(privacy_consent_at AT TIME ZONE 'America/Tegucigalpa', 'YYYY-MM-DD') AS privacy_consent_on,
  to_char(created_at AT TIME ZONE 'America/Tegucigalpa', 'YYYY-MM-DD') AS created_on`;

/** Escapa los comodines de LIKE para que lo que escribe el usuario se busque literalmente. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

/** Clientes en Postgres. El DNI se guarda cifrado (AES-256-GCM) y se busca por su huella HMAC. */
export class PostgresBorrowerRepository implements BorrowerRepository {
  constructor(
    private readonly db: Executor,
    private readonly cipher: FieldCipher,
  ) {}

  private borrowerOf(row: Row): Borrower {
    return {
      id: asString(row.id),
      organizationId: asString(row.organization_id),
      fullName: asString(row.full_name),
      nationalId: this.cipher.decrypt(row.national_id_enc as Buffer),
      phone: asNullableString(row.phone),
      address: asNullableString(row.address),
      status: asString(row.status) as BorrowerStatus,
      privacyConsentOn: asNullableString(row.privacy_consent_on),
      createdOn: asString(row.created_on),
    };
  }

  async save(borrower: Borrower): Promise<void> {
    await runStatement(
      this.db,
      `INSERT INTO borrowers
         (id, organization_id, full_name, national_id_enc, national_id_hash, phone, address, status, privacy_consent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date)
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone,
         address = EXCLUDED.address, status = EXCLUDED.status`,
      [
        borrower.id,
        borrower.organizationId,
        borrower.fullName,
        this.cipher.encrypt(borrower.nationalId),
        this.cipher.searchHash(borrower.nationalId),
        borrower.phone,
        borrower.address,
        borrower.status,
        borrower.privacyConsentOn,
      ],
    );
  }

  async findById(organizationId: string, id: string): Promise<Borrower | null> {
    const [row] = await selectRows(
      this.db,
      `SELECT ${COLUMNS} FROM borrowers WHERE organization_id = $1 AND id = $2`,
      [organizationId, id],
    );
    return row ? this.borrowerOf(row) : null;
  }

  async findByNationalId(organizationId: string, nationalId: string): Promise<Borrower | null> {
    const [row] = await selectRows(
      this.db,
      `SELECT ${COLUMNS} FROM borrowers WHERE organization_id = $1 AND national_id_hash = $2`,
      [organizationId, this.cipher.searchHash(nationalId)],
    );
    return row ? this.borrowerOf(row) : null;
  }

  async namesByIds(organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await selectRows(
      this.db,
      "SELECT id, full_name FROM borrowers WHERE organization_id = $1 AND id = ANY($2::uuid[])",
      [organizationId, [...ids]],
    );
    return new Map(rows.map((row) => [asString(row.id), asString(row.full_name)]));
  }

  async search(organizationId: string, search: BorrowerSearch): Promise<Borrower[]> {
    const rows = search.text
      ? await selectRows(
          this.db,
          `SELECT ${COLUMNS} FROM borrowers
           WHERE organization_id = $1 AND (full_name ILIKE $2 OR phone ILIKE $2)
           ORDER BY full_name LIMIT $3 OFFSET $4`,
          [organizationId, likePattern(search.text), search.limit, search.offset],
        )
      : await selectRows(
          this.db,
          `SELECT ${COLUMNS} FROM borrowers WHERE organization_id = $1
           ORDER BY full_name LIMIT $2 OFFSET $3`,
          [organizationId, search.limit, search.offset],
        );
    return rows.map((row) => this.borrowerOf(row));
  }
}
