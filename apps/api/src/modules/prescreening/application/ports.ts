import type { Answers, PrescreeningForm, PrescreeningOutcome, TriggeredRule } from "@app/domain";

export interface Submission {
  id: string;
  organizationId: string;
  formVersion: number;
  applicantName: string;
  phone: string;
  answers: Answers;
  outcome: PrescreeningOutcome;
  score: number;
  reasons: TriggeredRule[];
  status: "NEW" | "DECIDED";
  decision: "CONTINUE" | "DISCARD" | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedOn: string | null;
  contradictsOutcome: boolean | null;
  /** Fecha en que llegó (AAAA-MM-DD). */
  receivedOn: string;
}

export interface PublicOrganization {
  id: string;
  name: string;
}

export interface PrescreeningRepository {
  /** Busca una organización por el texto de su enlace público. */
  findOrganizationBySlug(slug: string): Promise<PublicOrganization | null>;
  slugOf(organizationId: string): Promise<string | null>;
  getForm(organizationId: string): Promise<PrescreeningForm | null>;
  saveForm(organizationId: string, form: PrescreeningForm): Promise<void>;
  saveSubmission(submission: Submission): Promise<void>;
  findSubmission(organizationId: string, id: string): Promise<Submission | null>;
  listSubmissions(organizationId: string, filter: { status?: "NEW" | "DECIDED" }): Promise<Submission[]>;
  recordDecision(
    organizationId: string,
    id: string,
    decision: { decision: "CONTINUE" | "DISCARD"; note: string | null; decidedBy: string; decidedOn: string; contradictsOutcome: boolean },
  ): Promise<void>;
}
