export type AnswerValue = string | number | boolean;
export type QuestionType = "YES_NO" | "CHOICE" | "NUMBER" | "TEXT";

export interface Question {
  key: string;
  text: string;
  type: QuestionType;
  /** Opciones válidas; obligatorio solo para preguntas de tipo CHOICE. */
  options?: readonly string[];
}

export type Condition =
  | { op: "EQUALS"; value: AnswerValue }
  | { op: "NOT_EQUALS"; value: AnswerValue }
  | { op: "IN"; values: readonly AnswerValue[] }
  | { op: "AT_LEAST"; value: number }
  | { op: "AT_MOST"; value: number };

/**
 * - KNOCKOUT: si la condición se cumple, el resultado es NO APLICA.
 * - SCORED: si la condición se cumple, suma (o resta) puntos.
 * Una pregunta sin reglas es solo informativa.
 */
export type Rule =
  | { kind: "KNOCKOUT"; questionKey: string; when: Condition; reason: string }
  | { kind: "SCORED"; questionKey: string; when: Condition; points: number; reason: string };

export interface PrescreeningThresholds {
  /** Puntaje mínimo para APLICA. */
  appliesMin: number;
  /** Puntaje mínimo para REVISAR (por debajo de este valor, NO APLICA). */
  reviewMin: number;
}

/** Plantilla versionada de pre-calificación: preguntas, reglas y umbrales. */
export interface PrescreeningForm {
  version: number;
  questions: readonly Question[];
  rules: readonly Rule[];
  thresholds: PrescreeningThresholds;
}

export class InvalidPrescreeningFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPrescreeningFormError";
  }
}

function fail(message: string): never {
  throw new InvalidPrescreeningFormError(message);
}

function validateQuestions(questions: readonly Question[]): void {
  if (questions.length === 0) {
    fail("La plantilla debe tener al menos una pregunta");
  }
  const keys = new Set<string>();
  for (const question of questions) {
    if (question.key.trim() === "" || question.text.trim() === "") {
      fail("Cada pregunta necesita una clave y un texto");
    }
    if (keys.has(question.key)) {
      fail(`La clave de pregunta "${question.key}" está repetida`);
    }
    keys.add(question.key);
    if (question.type === "CHOICE") {
      const options = question.options ?? [];
      if (options.length === 0 || new Set(options).size !== options.length) {
        fail(`La pregunta "${question.key}" necesita opciones distintas entre sí`);
      }
    }
  }
}

function requireCompatibleCondition(question: Question, condition: Condition): void {
  const label = `La regla de "${question.key}"`;
  switch (question.type) {
    case "TEXT":
      return fail(`${label}: las preguntas de texto libre son solo informativas`);
    case "YES_NO":
      if ((condition.op !== "EQUALS" && condition.op !== "NOT_EQUALS") || typeof condition.value !== "boolean") {
        fail(`${label}: una pregunta de sí/no solo admite EQUALS o NOT_EQUALS con verdadero o falso`);
      }
      return;
    case "NUMBER": {
      const values = condition.op === "IN" ? condition.values : [condition.value];
      if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
        fail(`${label}: una pregunta numérica solo admite números`);
      }
      return;
    }
    case "CHOICE": {
      if (condition.op === "AT_LEAST" || condition.op === "AT_MOST") {
        fail(`${label}: una pregunta de opciones no admite AT_LEAST ni AT_MOST`);
      }
      const values = condition.op === "IN" ? condition.values : [condition.value];
      const options = question.options ?? [];
      if (!values.every((value) => typeof value === "string" && options.includes(value))) {
        fail(`${label}: el valor debe ser una de las opciones de la pregunta`);
      }
    }
  }
}

function validateRules(questions: readonly Question[], rules: readonly Rule[]): void {
  const byKey = new Map(questions.map((question) => [question.key, question]));
  for (const rule of rules) {
    const question = byKey.get(rule.questionKey);
    if (!question) {
      fail(`Una regla usa la pregunta "${rule.questionKey}", que no existe`);
    }
    if (rule.reason.trim() === "") {
      fail(`La regla de "${rule.questionKey}" necesita un motivo para poder explicar el resultado`);
    }
    if (rule.kind === "SCORED" && (!Number.isInteger(rule.points) || rule.points === 0)) {
      fail(`La regla de "${rule.questionKey}" necesita puntos enteros distintos de cero`);
    }
    requireCompatibleCondition(question, rule.when);
  }
}

/** Verifica que una plantilla sea coherente antes de guardarla o usarla. */
export function validatePrescreeningForm(form: PrescreeningForm): void {
  if (!Number.isInteger(form.version) || form.version < 1) {
    fail("La versión debe ser un entero mayor o igual a 1");
  }
  validateQuestions(form.questions);
  validateRules(form.questions, form.rules);
  const { appliesMin, reviewMin } = form.thresholds;
  if (!Number.isInteger(appliesMin) || !Number.isInteger(reviewMin) || reviewMin > appliesMin) {
    fail("Los umbrales deben ser enteros y el de revisión no puede superar al de aplica");
  }
}
