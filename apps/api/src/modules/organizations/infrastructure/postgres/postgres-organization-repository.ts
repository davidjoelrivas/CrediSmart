import { asString, selectRows, type Executor } from "../../../../shared/infrastructure/postgres/sql";
import type { OrganizationRepository, OrganizationSummary } from "../../application/ports";

export class PostgresOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: Executor) {}

  async findById(id: string): Promise<OrganizationSummary | null> {
    const [row] = await selectRows(this.db, "SELECT id, name FROM organizations WHERE id = $1", [id]);
    return row ? { id: asString(row.id), name: asString(row.name) } : null;
  }

  async listIds(): Promise<string[]> {
    const rows = await selectRows(this.db, "SELECT id FROM organizations ORDER BY created_at");
    return rows.map((row) => asString(row.id));
  }
}
