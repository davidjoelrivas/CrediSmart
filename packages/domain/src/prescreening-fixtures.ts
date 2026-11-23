import type { PrescreeningForm } from "./prescreening-form";

/** Plantilla de ejemplo solo para las pruebas; las preguntas reales las define el prestamista. */
export function exampleForm(overrides: Partial<PrescreeningForm> = {}): PrescreeningForm {
  return {
    version: 1,
    questions: [
      { key: "hasFixedIncome", text: "¿Tiene un ingreso fijo?", type: "YES_NO" },
      { key: "requestedAmount", text: "¿Cuánto solicita?", type: "NUMBER" },
      { key: "hasOverdueDebt", text: "¿Tiene una deuda atrasada con el negocio?", type: "YES_NO" },
      { key: "monthsAtJob", text: "¿Cuántos meses lleva en su trabajo?", type: "NUMBER" },
      { key: "hasReference", text: "¿Tiene quién lo recomiende?", type: "YES_NO" },
    ],
    rules: [
      {
        kind: "KNOCKOUT",
        questionKey: "hasOverdueDebt",
        when: { op: "EQUALS", value: true },
        reason: "Tiene una deuda atrasada con el negocio",
      },
      {
        kind: "KNOCKOUT",
        questionKey: "requestedAmount",
        when: { op: "AT_LEAST", value: 50_000 },
        reason: "El monto solicitado supera el máximo que presta el negocio",
      },
      {
        kind: "SCORED",
        questionKey: "hasFixedIncome",
        when: { op: "EQUALS", value: true },
        points: 3,
        reason: "Tiene un ingreso fijo",
      },
      {
        kind: "SCORED",
        questionKey: "monthsAtJob",
        when: { op: "AT_LEAST", value: 12 },
        points: 2,
        reason: "Lleva al menos un año en su trabajo",
      },
      {
        kind: "SCORED",
        questionKey: "hasReference",
        when: { op: "EQUALS", value: true },
        points: 1,
        reason: "Tiene quién lo recomiende",
      },
    ],
    thresholds: { appliesMin: 5, reviewMin: 3 },
    ...overrides,
  };
}
