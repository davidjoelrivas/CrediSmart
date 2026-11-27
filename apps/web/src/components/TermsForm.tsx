import {
  FREQUENCIES,
  INTEREST_METHODS,
  type Frequency,
  type InterestMethod,
  type LateFeeConfigRequest,
  type LoanTermsRequest,
  type SimulationView,
} from "@app/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { FREQUENCY_LABELS, INTEREST_METHOD_LABELS, formatBp, formatCents, formatDate } from "../lib/format";
import { parseLempiras, parsePercentToBp } from "../lib/money-input";
import { Badge, Card, ErrorNotice, Field, Loading, MoneyInput } from "./ui";

export interface TermsValues {
  principal: string;
  rate: string;
  ratePeriod: Frequency;
  paymentFrequency: Frequency;
  installments: string;
  interestMethod: InterestMethod;
  startDate: string;
  lateFeeType: LateFeeConfigRequest["type"];
  lateFeeValue: string;
  graceDays: string;
}

export function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

export const DEFAULT_TERMS: TermsValues = {
  principal: "",
  rate: "5",
  ratePeriod: "MONTHLY",
  paymentFrequency: "BIWEEKLY",
  installments: "4",
  interestMethod: "FLAT",
  startDate: "",
  lateFeeType: "NONE",
  lateFeeValue: "",
  graceDays: "0",
};

/** Convierte lo escrito en el formulario en la solicitud a la API; null mientras falte algo o sea inválido. */
export function termsRequestOf(values: TermsValues): LoanTermsRequest | null {
  const principalCents = parseLempiras(values.principal);
  const rateBp = parsePercentToBp(values.rate);
  const installments = Number(values.installments);
  if (!principalCents || principalCents <= 0 || rateBp === null || !Number.isInteger(installments) || installments < 1 || installments > 360) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.startDate)) {
    return null;
  }
  return {
    principalCents,
    rateBp,
    ratePeriod: values.ratePeriod,
    paymentFrequency: values.paymentFrequency,
    installments,
    interestMethod: values.interestMethod,
    startDate: values.startDate,
  };
}

/** La política de mora escrita en el formulario; null si el valor falta o es inválido. */
export function lateFeeOf(values: TermsValues): LateFeeConfigRequest | null {
  switch (values.lateFeeType) {
    case "NONE":
      return { type: "NONE" };
    case "PERCENT_OF_OVERDUE":
    case "PERCENT_PER_DAY": {
      const rateBp = parsePercentToBp(values.lateFeeValue);
      return rateBp === null ? null : { type: values.lateFeeType, rateBp };
    }
    case "FIXED_PER_DAY": {
      const amountCents = parseLempiras(values.lateFeeValue);
      return amountCents && amountCents > 0 ? { type: "FIXED_PER_DAY", amountCents } : null;
    }
  }
}

export function graceDaysOf(values: TermsValues): number | null {
  const days = Number(values.graceDays);
  return Number.isInteger(days) && days >= 0 && days <= 60 ? days : null;
}

export function useSimulation(terms: LoanTermsRequest | null) {
  // Espera a que la persona deje de escribir antes de pedir el cálculo. Se compara por contenido (texto),
  // no por identidad del objeto, para no volver a calcular en cada repintado.
  const key = JSON.stringify(terms);
  const [debouncedKey, setDebouncedKey] = useState(key);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKey(key), 350);
    return () => window.clearTimeout(timer);
  }, [key]);

  return useQuery({
    queryKey: ["simulate", debouncedKey],
    queryFn: () => api<SimulationView>("/loans/simulate", { method: "POST", body: { terms: JSON.parse(debouncedKey) as LoanTermsRequest } }),
    enabled: debouncedKey !== "null",
    staleTime: 60_000,
  });
}

export function TermsFields({
  values,
  onChange,
  withLateFee,
}: {
  values: TermsValues;
  onChange: (values: TermsValues) => void;
  withLateFee?: boolean;
}) {
  const set = <K extends keyof TermsValues>(key: K, value: TermsValues[K]) => onChange({ ...values, [key]: value });

  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="Monto del préstamo">
          {(props) => <MoneyInput {...props} value={values.principal} onChange={(value) => set("principal", value)} placeholder="10,000.00" />}
        </Field>
        <Field label="Tasa de interés" hint="En porcentaje, por el periodo elegido">
          {(props) => (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input {...props} value={values.rate} inputMode="decimal" onChange={(event) => set("rate", event.target.value)} />
              <select aria-label="Periodo de la tasa" value={values.ratePeriod} onChange={(event) => set("ratePeriod", event.target.value as Frequency)}>
                {FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {FREQUENCY_LABELS[frequency]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Field>
        <Field label="Frecuencia de pago">
          {(props) => (
            <select {...props} value={values.paymentFrequency} onChange={(event) => set("paymentFrequency", event.target.value as Frequency)}>
              {FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {FREQUENCY_LABELS[frequency]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Número de cuotas">
          {(props) => <input {...props} value={values.installments} inputMode="numeric" onChange={(event) => set("installments", event.target.value)} />}
        </Field>
        <Field label="Forma de calcular el interés">
          {(props) => (
            <select {...props} value={values.interestMethod} onChange={(event) => set("interestMethod", event.target.value as InterestMethod)}>
              {INTEREST_METHODS.map((method) => (
                <option key={method} value={method}>
                  {INTEREST_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Fecha de inicio">
          {(props) => <input {...props} type="date" value={values.startDate} onChange={(event) => set("startDate", event.target.value)} />}
        </Field>
      </div>

      {withLateFee ? (
        <div className="form-grid">
          <Field label="Mora por atraso">
            {(props) => (
              <select {...props} value={values.lateFeeType} onChange={(event) => onChange({ ...values, lateFeeType: event.target.value as TermsValues["lateFeeType"], lateFeeValue: "" })}>
                <option value="NONE">Sin mora</option>
                <option value="PERCENT_OF_OVERDUE">% del monto vencido (una sola vez)</option>
                <option value="PERCENT_PER_DAY">% diario sobre lo vencido</option>
                <option value="FIXED_PER_DAY">Monto fijo por cada día</option>
              </select>
            )}
          </Field>
          {values.lateFeeType === "FIXED_PER_DAY" ? (
            <Field label="Monto por día">
              {(props) => <MoneyInput {...props} value={values.lateFeeValue} onChange={(value) => set("lateFeeValue", value)} placeholder="25.00" />}
            </Field>
          ) : values.lateFeeType !== "NONE" ? (
            <Field label="Porcentaje de mora" hint={values.lateFeeType === "PERCENT_PER_DAY" ? "Por cada día de atraso" : "Sobre lo que está vencido"}>
              {(props) => <input {...props} value={values.lateFeeValue} inputMode="decimal" placeholder="5" onChange={(event) => set("lateFeeValue", event.target.value)} />}
            </Field>
          ) : null}
          {values.lateFeeType !== "NONE" ? (
            <Field label="Días de gracia" hint="Días después del vencimiento sin cobrar mora">
              {(props) => <input {...props} value={values.graceDays} inputMode="numeric" onChange={(event) => set("graceDays", event.target.value)} />}
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Plan de cuotas y totales de una simulación. */
export function SimulationResult({ terms, simulation }: { terms: LoanTermsRequest | null; simulation: ReturnType<typeof useSimulation> }) {
  if (terms === null) {
    return (
      <Card title="Resultado">
        <p className="muted">Completa el monto, la tasa, las cuotas y la fecha para ver el plan de pagos.</p>
      </Card>
    );
  }
  if (simulation.isPending) {
    return (
      <Card title="Resultado">
        <Loading label="Calculando…" />
      </Card>
    );
  }
  if (simulation.isError) {
    return <ErrorNotice error={simulation.error} />;
  }
  const data = simulation.data;
  return (
    <Card title="Resultado">
      <div className="stack">
        <div className="grid cols-3">
          <div className="stat">
            <span className="label">Total a pagar</span>
            <span className="value">{formatCents(data.totalToPayCents)}</span>
          </div>
          <div className="stat">
            <span className="label">Intereses</span>
            <span className="value">{formatCents(data.totalInterestCents)}</span>
          </div>
          <div className="stat">
            <span className="label">Tasa efectiva anual</span>
            <span className="value">{formatBp(data.aprBp)}</span>
            <span className="hint">Lo que de verdad cuesta el préstamo en un año</span>
          </div>
        </div>
        {data.exceedsAprCap && data.aprCapBp !== null ? (
          <div className="notice warn" role="alert">
            Esta tasa efectiva ({formatBp(data.aprBp)}) supera el tope legal configurado ({formatBp(data.aprCapBp)}). Para aprobarlo hay que dejar por escrito el motivo.
          </div>
        ) : data.aprCapBp !== null ? (
          <Badge tone="ok">Dentro del tope legal de {formatBp(data.aprCapBp)}</Badge>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Vence</th>
                <th className="num">Capital</th>
                <th className="num">Interés</th>
                <th className="num">Cuota</th>
              </tr>
            </thead>
            <tbody>
              {data.schedule.map((row) => (
                <tr key={row.number}>
                  <td>{row.number}</td>
                  <td>{formatDate(row.dueDate)}</td>
                  <td className="num">{formatCents(row.principalCents)}</td>
                  <td className="num">{formatCents(row.interestCents)}</td>
                  <td className="num">
                    <strong>{formatCents(row.totalCents)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
