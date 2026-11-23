import { describe, expect, it } from "vitest";
import {
  InvalidPrescreeningFormError,
  validatePrescreeningForm,
  type PrescreeningForm,
} from "./prescreening-form";
import { exampleForm } from "./prescreening-fixtures";

const rejects = (form: PrescreeningForm) =>
  expect(() => validatePrescreeningForm(form)).toThrow(InvalidPrescreeningFormError);

describe("validatePrescreeningForm", () => {
  it("acepta una plantilla coherente", () => {
    expect(() => validatePrescreeningForm(exampleForm())).not.toThrow();
  });

  it("rechaza una versión inválida", () => {
    rejects(exampleForm({ version: 0 }));
    rejects(exampleForm({ version: 1.5 }));
  });

  it("rechaza una plantilla sin preguntas", () => {
    rejects(exampleForm({ questions: [], rules: [] }));
  });

  it("rechaza claves repetidas o vacías", () => {
    const [first] = exampleForm().questions;
    rejects(exampleForm({ questions: [first!, first!], rules: [] }));
    rejects(exampleForm({ questions: [{ ...first!, key: " " }], rules: [] }));
  });

  it("exige opciones distintas en las preguntas de opciones", () => {
    const withoutOptions = { key: "job", text: "¿A qué se dedica?", type: "CHOICE" } as const;
    rejects(exampleForm({ questions: [withoutOptions], rules: [] }));
    rejects(
      exampleForm({
        questions: [{ ...withoutOptions, options: ["comercio", "comercio"] }],
        rules: [],
      }),
    );
  });

  it("rechaza reglas que apuntan a una pregunta inexistente", () => {
    rejects(
      exampleForm({
        rules: [
          {
            kind: "KNOCKOUT",
            questionKey: "noExiste",
            when: { op: "EQUALS", value: true },
            reason: "x",
          },
        ],
      }),
    );
  });

  it("rechaza reglas sin motivo o con puntos inválidos", () => {
    const base = exampleForm().rules[2]!;
    rejects(exampleForm({ rules: [{ ...base, reason: " " } as typeof base] }));
    rejects(exampleForm({ rules: [{ ...base, points: 0 } as typeof base] }));
    rejects(exampleForm({ rules: [{ ...base, points: 1.5 } as typeof base] }));
  });

  it("rechaza condiciones incompatibles con el tipo de pregunta", () => {
    const rule = (questionKey: string, when: PrescreeningForm["rules"][number]["when"]) =>
      ({ kind: "KNOCKOUT", questionKey, when, reason: "x" }) as const;

    rejects(exampleForm({ rules: [rule("hasFixedIncome", { op: "AT_LEAST", value: 1 })] }));
    rejects(exampleForm({ rules: [rule("hasFixedIncome", { op: "EQUALS", value: "sí" })] }));
    rejects(exampleForm({ rules: [rule("monthsAtJob", { op: "EQUALS", value: "doce" })] }));
  });

  it("rechaza reglas sobre preguntas de texto libre", () => {
    rejects(
      exampleForm({
        questions: [{ key: "notes", text: "Comentarios", type: "TEXT" }],
        rules: [
          { kind: "KNOCKOUT", questionKey: "notes", when: { op: "EQUALS", value: "x" }, reason: "x" },
        ],
      }),
    );
  });

  it("valida que el valor de una pregunta de opciones sea una de sus opciones", () => {
    const question = {
      key: "job",
      text: "¿A qué se dedica?",
      type: "CHOICE",
      options: ["comercio", "agricultura"],
    } as const;
    const ruleWith = (value: string) =>
      ({ kind: "KNOCKOUT", questionKey: "job", when: { op: "EQUALS", value }, reason: "x" }) as const;

    expect(() =>
      validatePrescreeningForm(exampleForm({ questions: [question], rules: [ruleWith("comercio")] })),
    ).not.toThrow();
    rejects(exampleForm({ questions: [question], rules: [ruleWith("minería")] }));
  });

  it("rechaza umbrales inconsistentes", () => {
    rejects(exampleForm({ thresholds: { appliesMin: 2, reviewMin: 5 } }));
    rejects(exampleForm({ thresholds: { appliesMin: 5.5, reviewMin: 3 } }));
  });
});
