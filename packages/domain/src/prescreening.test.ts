import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  evaluatePrescreening,
  InvalidAnswersError,
  InvalidDecisionError,
  recordDecision,
  type Answers,
} from "./prescreening";
import { exampleForm } from "./prescreening-fixtures";

function answersOf(overrides: Partial<Record<string, string | number | boolean>> = {}): Answers {
  return {
    hasFixedIncome: true,
    requestedAmount: 10_000,
    hasOverdueDebt: false,
    monthsAtJob: 24,
    hasReference: true,
    ...overrides,
  };
}

describe("evaluatePrescreening: resultado", () => {
  it("APLICA con el puntaje mínimo y explica por qué", () => {
    const result = evaluatePrescreening(exampleForm(), answersOf());

    expect(result.outcome).toBe("APPLIES");
    expect(result.score).toBe(6);
    expect(result.reasons.map((reason) => reason.questionKey)).toEqual([
      "hasFixedIncome",
      "monthsAtJob",
      "hasReference",
    ]);
  });

  it("pide REVISAR cuando el puntaje queda entre los dos umbrales", () => {
    const result = evaluatePrescreening(exampleForm(), answersOf({ monthsAtJob: 3 }));

    expect(result.score).toBe(4);
    expect(result.outcome).toBe("REVIEW");
  });

  it("NO APLICA cuando el puntaje no llega al umbral de revisión", () => {
    const result = evaluatePrescreening(
      exampleForm(),
      answersOf({ hasFixedIncome: false, monthsAtJob: 3 }),
    );

    expect(result.score).toBe(1);
    expect(result.outcome).toBe("NOT_APPLIES");
  });

  it("una regla eliminatoria gana aunque el puntaje sea alto", () => {
    const result = evaluatePrescreening(exampleForm(), answersOf({ hasOverdueDebt: true }));

    expect(result.score).toBe(6);
    expect(result.outcome).toBe("NOT_APPLIES");
    expect(result.reasons.some((reason) => reason.kind === "KNOCKOUT")).toBe(true);
  });

  it("aplica el borde exacto de una regla numérica", () => {
    expect(evaluatePrescreening(exampleForm(), answersOf({ requestedAmount: 49_999 })).outcome).toBe(
      "APPLIES",
    );
    expect(evaluatePrescreening(exampleForm(), answersOf({ requestedAmount: 50_000 })).outcome).toBe(
      "NOT_APPLIES",
    );
  });

  it("es determinista: las mismas respuestas dan el mismo resultado", () => {
    const first = evaluatePrescreening(exampleForm(), answersOf({ monthsAtJob: 6 }));
    const second = evaluatePrescreening(exampleForm(), answersOf({ monthsAtJob: 6 }));
    expect(second).toEqual(first);
  });
});

describe("evaluatePrescreening: respuestas inválidas", () => {
  it("rechaza respuestas faltantes", () => {
    const { hasReference: _omitted, ...incomplete } = answersOf();
    expect(() => evaluatePrescreening(exampleForm(), incomplete)).toThrow(InvalidAnswersError);
  });

  it("rechaza respuestas de tipo incorrecto", () => {
    expect(() => evaluatePrescreening(exampleForm(), answersOf({ hasFixedIncome: "sí" }))).toThrow(
      InvalidAnswersError,
    );
    expect(() =>
      evaluatePrescreening(exampleForm(), answersOf({ requestedAmount: Number.NaN })),
    ).toThrow(InvalidAnswersError);
  });

  it("rechaza respuestas que no corresponden a ninguna pregunta", () => {
    expect(() => evaluatePrescreening(exampleForm(), answersOf({ extra: true }))).toThrow(
      InvalidAnswersError,
    );
  });
});

describe("evaluatePrescreening: propiedades", () => {
  it("el puntaje es la suma de los puntos de las razones y NO APLICA si hay eliminatoria", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 100_000 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 600 }),
        fc.boolean(),
        (hasFixedIncome, requestedAmount, hasOverdueDebt, monthsAtJob, hasReference) => {
          const result = evaluatePrescreening(
            exampleForm(),
            answersOf({ hasFixedIncome, requestedAmount, hasOverdueDebt, monthsAtJob, hasReference }),
          );

          expect(result.score).toBe(result.reasons.reduce((sum, reason) => sum + reason.points, 0));
          if (result.reasons.some((reason) => reason.kind === "KNOCKOUT")) {
            expect(result.outcome).toBe("NOT_APPLIES");
          }
          if (result.outcome === "APPLIES") {
            expect(result.score).toBeGreaterThanOrEqual(5);
          }
        },
      ),
    );
  });
});

describe("recordDecision", () => {
  it("no pide nota cuando la decisión coincide con el resultado", () => {
    expect(recordDecision("APPLIES", "CONTINUE")).toEqual({
      decision: "CONTINUE",
      note: null,
      contradictsOutcome: false,
    });
    expect(recordDecision("NOT_APPLIES", "DISCARD").contradictsOutcome).toBe(false);
  });

  it("en REVISAR cualquier decisión es válida sin nota", () => {
    expect(recordDecision("REVIEW", "CONTINUE").contradictsOutcome).toBe(false);
    expect(recordDecision("REVIEW", "DISCARD").contradictsOutcome).toBe(false);
  });

  it("exige nota cuando se decide en contra del resultado", () => {
    expect(() => recordDecision("NOT_APPLIES", "CONTINUE")).toThrow(InvalidDecisionError);
    expect(() => recordDecision("APPLIES", "DISCARD", "   ")).toThrow(InvalidDecisionError);
  });

  it("guarda la nota limpia cuando contradice el resultado", () => {
    expect(recordDecision("NOT_APPLIES", "CONTINUE", "  Lo conozco hace años  ")).toEqual({
      decision: "CONTINUE",
      note: "Lo conozco hace años",
      contradictsOutcome: true,
    });
  });
});
