import type { PrescreeningForm, TriggeredRule } from "@app/domain";
import {
  asNullableString,
  asNumber,
  asString,
  runStatement,
  selectRows,
  type Executor,
  type Row,
} from "../../../../shared/infrastructure/postgres/sql";
import type { PrescreeningRepository, PublicOrganization, Submission } from "../../application/ports";

const COLUMNS = `id, organization_id, form_version, applicant_name, phone, answers, outcome, score, reasons,
  status, decision, decision_note, decided_by, decided_on, contradicts_outcome,
  to_char(created_at AT TIME ZONE 'America/Tegucigalpa', 'YYYY-MM-DD') AS received_on`;

function submissionOf(row: Row): Submission {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    formVersion: asNumber(row.form_version),
    applicantName: asString(row.applicant_name),
    phone: asString(row.phone),
    answers: row.answers as Submission["answers"],
    outcome: asString(row.outcome) as Submission["outcome"],
    score: asNumber(row.score),
    reasons: row.reasons as TriggeredRule[],
    status: asString(row.status) as Submission["status"],
    decision: asNullableString(row.decision) as Submission["decision"],
    decisionNote: asNullableString(row.decision_note),
    decidedBy: asNullableString(row.decided_by),
    decidedOn: asNullableString(row.decided_on),
    contradictsOutcome: row.contradicts_outcome === null ? null : Boolean(row.contradicts_outcome),
    receivedOn: asString(row.received_on),
  };
}

export class PostgresPrescreeningRepository implements PrescreeningRepository {
  constructor(private readonly db: Executor) {}

  async findOrganizationBySlug(slug: string): Promise<PublicOrganization | null> {
    const [row] = await selectRows(this.db, "SELECT id, name FROM organizations WHERE slug = $1", [slug]);
    return row ? { id: asString(row.id), name: asString(row.name) } : null;
  }

  async slugOf(organizationId: string): Promise<string | null> {
    const [row] = await selectRows(this.db, "SELECT slug FROM organizations WHERE id = $1", [organizationId]);
    return row ? asNullableString(row.slug) : null;
  }

  async getForm(organizationId: string): Promise<PrescreeningForm | null> {
    const [row] = await selectRows(
      this.db,
      "SELECT version, definition FROM prescreening_forms WHERE organization_id = $1",
      [organizationId],
    );
    if (!row) {
      return null;
    }
    return { ...(row.definition as Omit<PrescreeningForm, "version">), version: asNumber(row.version) };
  }

  async saveForm(organizationId: string, form: PrescreeningForm): Promise<void> {
    const { version, ...definition } = form;
    await runStatement(
      this.db,
      `INSERT INTO prescreening_forms (organization_id, version, definition) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (organization_id) DO UPDATE SET version = EXCLUDED.version, definition = EXCLUDED.definition,
         updated_at = now()`,
      [organizationId, version, JSON.stringify(definition)],
    );
  }

  async saveSubmission(submission: Submission): Promise<void> {
    await runStatement(
      this.db,
      `INSERT INTO prescreening_submissions
         (id, organization_id, form_version, applicant_name, phone, answers, outcome, score, reasons)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)`,
      [
        submission.id,
        submission.organizationId,
        submission.formVersion,
        submission.applicantName,
        submission.phone,
        JSON.stringify(submission.answers),
        submission.outcome,
        submission.score,
        JSON.stringify(submission.reasons),
      ],
    );
  }

  async findSubmission(organizationId: string, id: string): Promise<Submission | null> {
    const [row] = await selectRows(
      this.db,
      `SELECT ${COLUMNS} FROM prescreening_submissions WHERE organization_id = $1 AND id = $2`,
      [organizationId, id],
    );
    return row ? submissionOf(row) : null;
  }

  async listSubmissions(organizationId: string, filter: { status?: "NEW" | "DECIDED" }): Promise<Submission[]> {
    const rows = await selectRows(
      this.db,
      `SELECT ${COLUMNS} FROM prescreening_submissions
       WHERE organization_id = $1 AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC, id DESC LIMIT 200`,
      [organizationId, filter.status ?? null],
    );
    return rows.map(submissionOf);
  }

  async recordDecision(
    organizationId: string,
    id: string,
    decision: { decision: "CONTINUE" | "DISCARD"; note: string | null; decidedBy: string; decidedOn: string; contradictsOutcome: boolean },
  ): Promise<void> {
    await runStatement(
      this.db,
      `UPDATE prescreening_submissions
         SET status = 'DECIDED', decision = $3, decision_note = $4, decided_by = $5, decided_on = $6::date,
             contradicts_outcome = $7
       WHERE organization_id = $1 AND id = $2 AND status = 'NEW'`,
      [organizationId, id, decision.decision, decision.note, decision.decidedBy, decision.decidedOn, decision.contradictsOutcome],
    );
  }
}
