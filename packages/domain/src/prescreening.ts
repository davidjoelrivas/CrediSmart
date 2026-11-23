import {
  validatePrescreeningForm,
  type AnswerValue,
  type Condition,
  type PrescreeningForm,
  type Question,
} from "./prescreening-form";

export type PrescreeningOutcome = "APPLIES" | "REVIEW" | "NOT_APPLIES";
export type Answers = Readonly<Record<string, AnswerValue>>;

/** Una regla que se cumplió, con el motivo que se le muestra al prestamista. */
export interface TriggeredRule {
  questionKey: string;
  kind: "KNOCKOUT" | "SCORED";
  reason: string;
  /** Puntos que aportó; 0 en las reglas eliminatorias. */
  points: number;
}

export interface PrescreeningResult {
  outcome: PrescreeningOutcome;
  score: number;
  reasons: TriggeredRule[];
}

export class InvalidAnswersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnswersError";
  }
}

function isValidAnswer(question: Question, answer: AnswerValue | undefined): boolean {
  switch (question.type) {
    case "YES_NO":
      return typeof answer === "boolean";
    case "NUMBER":
      return typeof answer === "number" && Number.isFinite(answer);
    case "CHOICE":
      return typeof answer === "string" && (question.options ?? []).includes(answer);
    case "TEXT":
      return typeof answer === "string" && answer.trim() !== "";
  }
}

/** Todas las preguntas deben tener una respuesta del tipo correcto y no pueden sobrar respuestas. */
export function validateAnswers(form: PrescreeningForm, answers: Answers): void {
  const known = new Set(form.questions.map((question) => question.key));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) {
      throw new InvalidAnswersError(`La respuesta "${key}" no corresponde a ninguna pregunta`);
    }
  }
  for (const question of form.questions) {
    if (!isValidAnswer(question, answers[question.key])) {
      throw new InvalidAnswersError(`Falta la respuesta de "${question.key}" o no es válida`);
    }
  }
}

const CONDITION_CHECKS: {
  [Op in Condition["op"]]: (answer: AnswerValue, condition: Extract<Condition, { op: Op }>) => boolean;
} = {
  EQUALS: (answer, condition) => answer === condition.value,
  NOT_EQUALS: (answer, condition) => answer !== condition.value,
  IN: (answer, condition) => condition.values.includes(answer),
  AT_LEAST: (answer, condition) => typeof answer === "number" && answer >= condition.value,
  AT_MOST: (answer, condition) => typeof answer === "number" && answer <= condition.value,
};

function conditionHolds(answer: AnswerValue, condition: Condition): boolean {
  const check = CONDITION_CHECKS[condition.op] as (a: AnswerValue, c: Condition) => boolean;
  return check(answer, condition);
}

/**
 * Evalúa las respuestas con las reglas de la plantilla. Es determinista y
 * explicable: devuelve el puntaje y la lista de reglas que se cumplieron.
 * El resultado es orientativo; la decisión final siempre es del prestamista.
 */
export function evaluatePrescreening(form: PrescreeningForm, answers: Answers): PrescreeningResult {
  validatePrescreeningForm(form);
  validateAnswers(form, answers);

  const reasons: TriggeredRule[] = [];
  for (const rule of form.rules) {
    if (!conditionHolds(answers[rule.questionKey]!, rule.when)) {
      continue;
    }
    reasons.push({
      questionKey: rule.questionKey,
      kind: rule.kind,
      reason: rule.reason,
      points: rule.kind === "SCORED" ? rule.points : 0,
    });
  }

  const score = reasons.reduce((sum, reason) => sum + reason.points, 0);
  const { appliesMin, reviewMin } = form.thresholds;

  let outcome: PrescreeningOutcome;
  if (reasons.some((reason) => reason.kind === "KNOCKOUT")) {
    outcome = "NOT_APPLIES";
  } else if (score >= appliesMin) {
    outcome = "APPLIES";
  } else if (score >= reviewMin) {
    outcome = "REVIEW";
  } else {
    outcome = "NOT_APPLIES";
  }
  return { outcome, score, reasons };
}

export type Decision = "CONTINUE" | "DISCARD";

export interface RecordedDecision {
  decision: Decision;
  note: string | null;
  /** Verdadero si el prestamista decidió en contra del resultado orientativo. */
  contradictsOutcome: boolean;
}

export class InvalidDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDecisionError";
  }
}

/**
 * Registra la decisión del prestamista. Puede contradecir el resultado
 * orientativo, pero entonces la nota es obligatoria para dejar constancia.
 */
export function recordDecision(
  outcome: PrescreeningOutcome,
  decision: Decision,
  note?: string,
): RecordedDecision {
  const contradictsOutcome =
    (outcome === "NOT_APPLIES" && decision === "CONTINUE") ||
    (outcome === "APPLIES" && decision === "DISCARD");
  const cleanNote = note?.trim() ? note.trim() : null;

  if (contradictsOutcome && cleanNote === null) {
    throw new InvalidDecisionError(
      "Decidir en contra del resultado orientativo requiere una nota con el motivo",
    );
  }
  return { decision, note: cleanNote, contradictsOutcome };
}
