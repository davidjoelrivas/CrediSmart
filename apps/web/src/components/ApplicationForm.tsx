import type { QuestionView } from "@app/contracts";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, ErrorNotice, Field } from "./ui";

type AnswerState = Record<string, string>;
export type Answers = Record<string, string | number | boolean>;

/** Convierte lo escrito en la respuesta tipada que espera la API; null si falta algo o no es válido. */
export function typedAnswers(questions: QuestionView[], raw: AnswerState): Answers | null {
  const result: Answers = {};
  for (const question of questions) {
    const value = raw[question.key];
    if (value === undefined || value.trim() === "") {
      return null;
    }
    if (question.type === "YES_NO") {
      result[question.key] = value === "yes";
    } else if (question.type === "NUMBER") {
      const number = Number(value.replace(/,/g, ""));
      if (!Number.isFinite(number)) {
        return null;
      }
      result[question.key] = number;
    } else {
      result[question.key] = value.trim();
    }
  }
  return result;
}

export interface ApplicationBody {
  applicantName: string;
  phone: string;
  answers: Answers;
  privacyConsent: boolean;
}

/** Formulario de solicitud: lo usa la persona interesada (enlace público) y el prestamista (cuando la recibió por chat). */
export function ApplicationForm({
  questions,
  consentText,
  submitLabel,
  pending,
  error,
  onSubmit,
  footer,
}: {
  questions: QuestionView[];
  consentText: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (body: ApplicationBody) => void;
  footer?: ReactNode;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [answers, setAnswers] = useState<AnswerState>({});
  const [consent, setConsent] = useState(false);

  const parsed = typedAnswers(questions, answers);
  const ready = name.trim().length >= 3 && phone.trim().length >= 8 && parsed !== null && consent;
  const set = (key: string) => (event: { target: { value: string } }) => setAnswers({ ...answers, [key]: event.target.value });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (parsed) {
      onSubmit({ applicantName: name, phone, answers: parsed, privacyConsent: consent });
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error ? <ErrorNotice error={error} /> : null}
      <Field label="Nombre completo">
        {(props) => <input {...props} value={name} autoComplete="name" onChange={(event) => setName(event.target.value)} />}
      </Field>
      <Field label="Teléfono (WhatsApp)" hint="8 dígitos">
        {(props) => <input {...props} value={phone} inputMode="tel" autoComplete="tel" onChange={(event) => setPhone(event.target.value)} />}
      </Field>
      {questions.map((question) => (
        <Field key={question.key} label={question.text}>
          {(props) =>
            question.type === "YES_NO" ? (
              <select {...props} value={answers[question.key] ?? ""} onChange={set(question.key)}>
                <option value="">Elige…</option>
                <option value="yes">Sí</option>
                <option value="no">No</option>
              </select>
            ) : question.type === "CHOICE" ? (
              <select {...props} value={answers[question.key] ?? ""} onChange={set(question.key)}>
                <option value="">Elige…</option>
                {(question.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : question.type === "NUMBER" ? (
              <input {...props} inputMode="decimal" value={answers[question.key] ?? ""} onChange={set(question.key)} />
            ) : (
              <textarea {...props} rows={2} value={answers[question.key] ?? ""} onChange={set(question.key)} />
            )
          }
        </Field>
      ))}
      <label className="check">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>{consentText}</span>
      </label>
      <Button type="submit" variant="accent" loading={pending} disabled={!ready}>
        {submitLabel}
      </Button>
      {footer}
    </form>
  );
}
