import {
  evaluatePrescreening,
  InvalidAnswersError,
  InvalidDecisionError,
  InvalidPrescreeningFormError,
  recordDecision,
  validatePrescreeningForm,
  type Answers,
  type PrescreeningForm,
} from "@app/domain";
import type { PrescreeningFormView, PublicFormView, QuestionView, SubmissionView } from "@app/contracts";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/application/errors";
import type { Clock, IdGenerator, RequestContext, UnitOfWork } from "../../../shared/application/ports";
import type { Repositories } from "../../../shared/application/repositories";
import { normalizePhone } from "../../identity/domain/user";
import type { Submission } from "./ports";

/** Quien figura en la bitácora cuando la solicitud la envió alguien desde el enlace público. */
export const PUBLIC_FORM_ACTOR = "formulario-publico";

/**
 * Plantilla inicial. Son las cinco preguntas típicas de una precalificación por WhatsApp; el prestamista las
 * reemplaza por las suyas (y ajusta puntos y umbrales) desde la pantalla de precalificación.
 */
export const DEFAULT_PRESCREENING_FORM: PrescreeningForm = {
  version: 1,
  questions: [
    { key: "tieneIngresoFijo", text: "¿Tiene un ingreso fijo (sueldo o negocio propio)?", type: "YES_NO" },
    { key: "montoSolicitado", text: "¿Cuánto dinero necesita, en lempiras?", type: "NUMBER" },
    { key: "deudaAtrasada", text: "¿Tiene alguna deuda atrasada en este momento?", type: "YES_NO" },
    { key: "mesesEnTrabajo", text: "¿Cuántos meses lleva en su trabajo o negocio?", type: "NUMBER" },
    { key: "tieneReferencia", text: "¿Alguien que ya nos conozca lo recomienda?", type: "YES_NO" },
  ],
  rules: [
    { kind: "KNOCKOUT", questionKey: "deudaAtrasada", when: { op: "EQUALS", value: true }, reason: "Tiene una deuda atrasada" },
    { kind: "KNOCKOUT", questionKey: "montoSolicitado", when: { op: "AT_LEAST", value: 50_000 }, reason: "Pide más del máximo que presta el negocio" },
    { kind: "SCORED", questionKey: "tieneIngresoFijo", when: { op: "EQUALS", value: true }, points: 3, reason: "Tiene un ingreso fijo" },
    { kind: "SCORED", questionKey: "mesesEnTrabajo", when: { op: "AT_LEAST", value: 12 }, points: 2, reason: "Lleva al menos un año en su trabajo o negocio" },
    { kind: "SCORED", questionKey: "tieneReferencia", when: { op: "EQUALS", value: true }, points: 1, reason: "Tiene quien lo recomiende" },
  ],
  thresholds: { appliesMin: 5, reviewMin: 3 },
};

function questionViews(form: PrescreeningForm): QuestionView[] {
  return form.questions.map((question) => ({
    key: question.key,
    text: question.text,
    type: question.type,
    ...(question.options ? { options: [...question.options] } : {}),
  }));
}

function answerText(value: string | number | boolean | undefined): string {
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return value === undefined ? "—" : String(value);
}

export function submissionView(submission: Submission, form: PrescreeningForm | null): SubmissionView {
  const questions = new Map((form?.questions ?? []).map((question) => [question.key, question.text]));
  return {
    id: submission.id,
    applicantName: submission.applicantName,
    phone: submission.phone,
    receivedOn: submission.receivedOn,
    formVersion: submission.formVersion,
    outcome: submission.outcome,
    score: submission.score,
    reasons: submission.reasons.map((reason) => ({ ...reason })),
    answers: Object.entries(submission.answers).map(([key, answer]) => ({
      key,
      question: questions.get(key) ?? key,
      answer: answerText(answer),
    })),
    status: submission.status,
    decision: submission.decision,
    decisionNote: submission.decisionNote,
    decidedOn: submission.decidedOn,
    contradictsOutcome: submission.contradictsOutcome,
  };
}

async function currentForm(repositories: Repositories, organizationId: string): Promise<PrescreeningForm> {
  return (await repositories.prescreening.getForm(organizationId)) ?? DEFAULT_PRESCREENING_FORM;
}

/** Formulario público: solo las preguntas. Las reglas y el puntaje jamás salen al solicitante. */
export class GetPublicForm {
  constructor(private readonly deps: { repositories: Repositories }) {}

  async execute(slug: string): Promise<PublicFormView> {
    const organization = await this.deps.repositories.prescreening.findOrganizationBySlug(slug);
    if (!organization) {
      throw new NotFoundError("Formulario", slug);
    }
    const form = await currentForm(this.deps.repositories, organization.id);
    return { organizationName: organization.name, version: form.version, questions: questionViews(form) };
  }
}

export interface SubmitInput {
  slug: string;
  applicantName: string;
  phone: string;
  answers: Answers;
  privacyConsent: boolean;
}

/** Recibe una solicitud del enlace público, la evalúa con las reglas del negocio y la deja en la bandeja. */
export class SubmitPrescreening {
  constructor(private readonly deps: { unitOfWork: UnitOfWork<Repositories>; clock: Clock; ids: IdGenerator }) {}

  /** Solicitud enviada por la propia persona desde el enlace público. */
  async execute(input: SubmitInput): Promise<{ received: true }> {
    return this.receive({ slug: input.slug }, PUBLIC_FORM_ACTOR, input);
  }

  /** Solicitud que recibió el prestamista por chat o llamada y registra él mismo (la persona dio su consentimiento de palabra). */
  async executeForStaff(context: RequestContext, input: Omit<SubmitInput, "slug">): Promise<{ received: true }> {
    return this.receive({ organizationId: context.organizationId }, context.actorId, input);
  }

  private async receive(
    target: { slug: string } | { organizationId: string },
    actorId: string,
    input: Omit<SubmitInput, "slug">,
  ): Promise<{ received: true }> {
    if (!input.privacyConsent) {
      throw new ValidationError("Necesitamos tu autorización para guardar tus datos y evaluar tu solicitud");
    }
    let phone: string;
    try {
      phone = normalizePhone(input.phone);
    } catch {
      throw new ValidationError("El teléfono debe tener 8 dígitos");
    }
    const applicantName = input.applicantName.trim().replace(/\s+/g, " ");
    if (applicantName.length < 3 || applicantName.length > 160) {
      throw new ValidationError("Escribe tu nombre completo");
    }
    const today = this.deps.clock.today();

    return this.deps.unitOfWork.run(async (repositories) => {
      const organization =
        "slug" in target
          ? await repositories.prescreening.findOrganizationBySlug(target.slug)
          : await repositories.organizations.findById(target.organizationId);
      if (!organization) {
        throw new NotFoundError("Formulario", "slug" in target ? target.slug : target.organizationId);
      }
      const form = await currentForm(repositories, organization.id);
      let result;
      try {
        result = evaluatePrescreening(form, input.answers);
      } catch (error) {
        if (error instanceof InvalidAnswersError) {
          throw new ValidationError(error.message);
        }
        throw error;
      }

      const submission: Submission = {
        id: this.deps.ids.newId(),
        organizationId: organization.id,
        formVersion: form.version,
        applicantName,
        phone,
        answers: input.answers,
        outcome: result.outcome,
        score: result.score,
        reasons: result.reasons,
        status: "NEW",
        decision: null,
        decisionNote: null,
        decidedBy: null,
        decidedOn: null,
        contradictsOutcome: null,
        receivedOn: today,
      };
      await repositories.prescreening.saveSubmission(submission);
      await repositories.audit.record({
        organizationId: organization.id,
        actorId,
        action: "PRESCREENING_RECEIVED",
        entity: "prescreening",
        entityId: submission.id,
        on: today,
        // El resultado orientativo queda en la bitácora; los datos personales no.
        details: { outcome: result.outcome, score: result.score, formVersion: form.version },
      });
      return { received: true };
    });
  }
}

/** Bandeja de solicitudes y su detalle explicado (qué reglas pesaron). */
export class PrescreeningQueries {
  constructor(private readonly deps: { repositories: Repositories }) {}

  async list(context: RequestContext, filter: { status?: "NEW" | "DECIDED" } = {}): Promise<SubmissionView[]> {
    const form = await currentForm(this.deps.repositories, context.organizationId);
    const submissions = await this.deps.repositories.prescreening.listSubmissions(context.organizationId, filter);
    return submissions.map((submission) => submissionView(submission, form));
  }

  async get(context: RequestContext, id: string): Promise<SubmissionView> {
    const submission = await this.deps.repositories.prescreening.findSubmission(context.organizationId, id);
    if (!submission) {
      throw new NotFoundError("Solicitud", id);
    }
    return submissionView(submission, await currentForm(this.deps.repositories, context.organizationId));
  }

  async formFor(context: RequestContext): Promise<PrescreeningFormView> {
    const saved = await this.deps.repositories.prescreening.getForm(context.organizationId);
    const form = saved ?? DEFAULT_PRESCREENING_FORM;
    return {
      slug: await this.deps.repositories.prescreening.slugOf(context.organizationId),
      version: form.version,
      isDefault: saved === null,
      definition: { questions: questionViews(form), rules: [...form.rules], thresholds: form.thresholds },
    };
  }
}

/** La decisión sobre una persona es siempre humana: el sistema solo orienta. Decidir en contra exige una nota. */
export class DecideSubmission {
  constructor(private readonly deps: { unitOfWork: UnitOfWork<Repositories>; clock: Clock }) {}

  async execute(
    context: RequestContext,
    input: { submissionId: string; decision: "CONTINUE" | "DISCARD"; note?: string },
  ): Promise<SubmissionView> {
    const today = this.deps.clock.today();
    return this.deps.unitOfWork.run(async (repositories) => {
      const submission = await repositories.prescreening.findSubmission(context.organizationId, input.submissionId);
      if (!submission) {
        throw new NotFoundError("Solicitud", input.submissionId);
      }
      if (submission.status === "DECIDED") {
        throw new ConflictError("Esta solicitud ya tiene una decisión registrada");
      }
      let recorded;
      try {
        recorded = recordDecision(submission.outcome, input.decision, input.note);
      } catch (error) {
        if (error instanceof InvalidDecisionError) {
          throw new ValidationError(error.message);
        }
        throw error;
      }
      await repositories.prescreening.recordDecision(context.organizationId, submission.id, {
        decision: recorded.decision,
        note: recorded.note,
        decidedBy: context.actorId,
        decidedOn: today,
        contradictsOutcome: recorded.contradictsOutcome,
      });
      await repositories.audit.record({
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: "PRESCREENING_DECIDED",
        entity: "prescreening",
        entityId: submission.id,
        on: today,
        details: {
          decision: recorded.decision,
          outcome: submission.outcome,
          contradictsOutcome: recorded.contradictsOutcome,
          note: recorded.note,
        },
      });
      const updated = (await repositories.prescreening.findSubmission(context.organizationId, submission.id))!;
      return submissionView(updated, await currentForm(repositories, context.organizationId));
    });
  }
}

/** Guarda una plantilla nueva (sube la versión). Las solicitudes viejas conservan la versión con la que se evaluaron. */
export class SaveFormTemplate {
  constructor(private readonly deps: { unitOfWork: UnitOfWork<Repositories>; clock: Clock }) {}

  async execute(
    context: RequestContext,
    definition: Pick<PrescreeningForm, "questions" | "rules" | "thresholds">,
  ): Promise<PrescreeningFormView> {
    const today = this.deps.clock.today();
    return this.deps.unitOfWork.run(async (repositories) => {
      const previous = await currentForm(repositories, context.organizationId);
      const form: PrescreeningForm = { ...definition, version: previous.version + 1 };
      try {
        validatePrescreeningForm(form);
      } catch (error) {
        if (error instanceof InvalidPrescreeningFormError) {
          throw new ValidationError(error.message);
        }
        throw error;
      }
      await repositories.prescreening.saveForm(context.organizationId, form);
      await repositories.audit.record({
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: "PRESCREENING_FORM_UPDATED",
        entity: "prescreening_form",
        entityId: context.organizationId,
        on: today,
        details: { version: form.version, questions: form.questions.length, rules: form.rules.length },
      });
      return {
        slug: await repositories.prescreening.slugOf(context.organizationId),
        version: form.version,
        isDefault: false,
        definition: { questions: questionViews(form), rules: [...form.rules], thresholds: form.thresholds },
      };
    });
  }
}
