import type { PrescreeningFormView, PrescreeningOutcomeName, SubmissionView } from "@app/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, Loading, Modal, PageHead, useToast, type Tone } from "../components/ui";
import { ApplicationForm } from "../components/ApplicationForm";
import { api, messageOf } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/format";

const OUTCOME: Record<PrescreeningOutcomeName, { label: string; tone: Tone; hint: string }> = {
  APPLIES: { label: "Aplica", tone: "ok", hint: "Cumple lo que pides" },
  REVIEW: { label: "Revisar", tone: "warn", hint: "Cumple en parte: conviene hablar con la persona" },
  NOT_APPLIES: { label: "No aplica", tone: "danger", hint: "No cumple algo importante" },
};

function SubmissionModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ["prescreening", id],
    queryFn: () => api<{ submission: SubmissionView }>(`/prescreening/${id}`),
    select: (data) => data.submission,
  });
  const [note, setNote] = useState("");

  const decide = useMutation({
    mutationFn: (decision: "CONTINUE" | "DISCARD") =>
      api<{ submission: SubmissionView }>(`/prescreening/${id}/decision`, { method: "POST", body: { decision, note: note || undefined } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["prescreening"] });
      void queryClient.invalidateQueries({ queryKey: ["prescreening-list"] });
      toast("Decisión registrada.");
    },
  });

  if (detail.isPending) {
    return (
      <Modal title="Solicitud" onClose={onClose}>
        <Loading />
      </Modal>
    );
  }
  if (detail.isError) {
    return (
      <Modal title="Solicitud" onClose={onClose}>
        <ErrorNotice error={detail.error} />
      </Modal>
    );
  }
  const item = detail.data;
  const outcome = OUTCOME[item.outcome];

  return (
    <Modal title={item.applicantName} onClose={onClose}>
      <div className="stack">
        <div className="row spread">
          <span>
            <Badge tone={outcome.tone}>{outcome.label}</Badge> <span className="muted small">{outcome.hint}</span>
          </span>
          <span className="muted small">Puntaje {item.score} · {formatDate(item.receivedOn)}</span>
        </div>

        <div>
          <h3 style={{ marginBottom: 6 }}>Por qué salió así</h3>
          {item.reasons.length === 0 ? (
            <p className="muted small">Ninguna regla sumó ni descartó.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {item.reasons.map((reason) => (
                <li key={`${reason.questionKey}-${reason.reason}`}>
                  {reason.reason}{" "}
                  <span className="muted small">{reason.kind === "KNOCKOUT" ? "(descarta)" : `(${reason.points > 0 ? "+" : ""}${reason.points})`}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 style={{ marginBottom: 6 }}>Sus respuestas</h3>
          <dl className="kv">
            <dt>Teléfono</dt>
            <dd>{item.phone}</dd>
            {item.answers.map((answer) => (
              <Fragment key={answer.key}>
                <dt>{answer.question}</dt>
                <dd>{answer.answer}</dd>
              </Fragment>
            ))}
          </dl>
        </div>

        {item.status === "DECIDED" ? (
          <div className={`notice ${item.decision === "CONTINUE" ? "ok" : ""}`}>
            Decisión: <strong>{item.decision === "CONTINUE" ? "Continuar con la solicitud" : "Descartada"}</strong> el {formatDate(item.decidedOn)}.
            {item.contradictsOutcome ? " (Contradice el resultado orientativo.)" : ""}
            {item.decisionNote ? <div>Nota: {item.decisionNote}</div> : null}
            {item.decision === "CONTINUE" ? (
              <div style={{ marginTop: 8 }}>
                <Link className="btn accent small" to={`/clientes?nuevo=${encodeURIComponent(item.applicantName)}&tel=${item.phone}`}>
                  Registrar como cliente
                </Link>
              </div>
            ) : null}
          </div>
        ) : can("prescreening:decide") ? (
          <>
            {decide.isError ? <ErrorNotice error={decide.error} /> : null}
            <Field label="Nota" hint="Obligatoria si decides distinto a lo que sugiere el sistema">
              {(props) => <textarea {...props} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />}
            </Field>
            <p className="muted small">El sistema solo orienta. La decisión sobre una persona siempre la tomas tú.</p>
            <div className="modal-actions">
              <Button variant="secondary" loading={decide.isPending} onClick={() => decide.mutate("DISCARD")}>
                Descartar
              </Button>
              <Button variant="accent" loading={decide.isPending} onClick={() => decide.mutate("CONTINUE")}>
                Continuar con esta persona
              </Button>
            </div>
          </>
        ) : (
          <p className="muted small">Solo el dueño puede decidir sobre una solicitud.</p>
        )}
      </div>
    </Modal>
  );
}

/** El prestamista registra una solicitud que le llegó por WhatsApp o llamada: se evalúa igual que las del enlace. */
function ManualEntryModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useQuery({
    queryKey: ["prescreening-form"],
    queryFn: () => api<{ form: PrescreeningFormView }>("/prescreening/form"),
    select: (data) => data.form,
  });
  const submit = useMutation({
    mutationFn: (body: object) => api("/prescreening", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["prescreening-list"] });
      toast("Solicitud registrada. Ya aparece en la bandeja con su resultado.");
      onClose();
    },
  });

  return (
    <Modal title="Registrar solicitud recibida por chat" onClose={onClose}>
      {form.isPending ? (
        <Loading />
      ) : form.isError ? (
        <ErrorNotice error={form.error} />
      ) : (
        <ApplicationForm
          questions={form.data.definition.questions}
          consentText="La persona me autorizó (de palabra o por escrito) a guardar sus datos para evaluar su solicitud."
          submitLabel="Registrar y evaluar"
          pending={submit.isPending}
          error={submit.error}
          onSubmit={(body) => submit.mutate(body)}
        />
      )}
    </Modal>
  );
}

function FormConfig() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const form = useQuery({
    queryKey: ["prescreening-form"],
    queryFn: () => api<{ form: PrescreeningFormView }>("/prescreening/form"),
    select: (data) => data.form,
  });
  const [json, setJson] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const save = useMutation({
    mutationFn: (definition: unknown) => api<{ form: PrescreeningFormView }>("/prescreening/form", { method: "PUT", body: definition }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["prescreening-form"] });
      setJson(null);
      toast("Preguntas actualizadas. Las solicitudes nuevas usarán esta versión.");
    },
  });

  if (!form.data) {
    return null;
  }
  const link = form.data.slug ? `${window.location.origin}/aplicar/${form.data.slug}` : null;
  const text = json ?? JSON.stringify(form.data.definition, null, 2);

  function trySave() {
    try {
      save.mutate(JSON.parse(text));
    } catch {
      toast("El texto no es un JSON válido.", "danger");
    }
  }

  return (
    <Card title="Enlace y preguntas">
      <div className="stack">
        {link ? (
          <div className="row">
            <input readOnly value={link} aria-label="Enlace público" style={{ flex: 1, minWidth: 220 }} onFocus={(event) => event.target.select()} />
            <Button
              variant="secondary"
              onClick={() => navigator.clipboard.writeText(link).then(() => toast("Enlace copiado. Pégalo en WhatsApp."), () => toast("No se pudo copiar.", "danger"))}
            >
              Copiar enlace
            </Button>
          </div>
        ) : (
          <div className="notice warn">Esta organización todavía no tiene enlace público.</div>
        )}
        <p className="muted small">
          Versión {form.data.version} de las preguntas {form.data.isDefault ? "(plantilla inicial: cámbiala por tus 5 preguntas)" : ""}. Quien abre el enlace solo ve las preguntas, nunca el puntaje ni las reglas.
        </p>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {form.data.definition.questions.map((question) => (
            <li key={question.key}>{question.text}</li>
          ))}
        </ol>
        <div>
          <Button variant="ghost" small onClick={() => setOpen(!open)}>
            {open ? "Ocultar editor avanzado" : "Editar preguntas y reglas (avanzado)"}
          </Button>
        </div>
        {open ? (
          <div className="stack">
            <p className="muted small">
              Cada pregunta tiene una clave, un texto y un tipo (YES_NO, NUMBER, CHOICE o TEXT). Las reglas pueden descartar (KNOCKOUT) o sumar puntos (SCORED). Si algo está mal, el sistema te dice qué.
            </p>
            <textarea aria-label="Definición de las preguntas" rows={14} spellCheck={false} style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: "0.82rem" }} value={text} onChange={(event) => setJson(event.target.value)} />
            {save.isError ? <div className="notice danger" role="alert">{messageOf(save.error)}</div> : null}
            <div>
              <Button loading={save.isPending} onClick={trySave}>
                Guardar nueva versión
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function PrescreeningPage() {
  const [filter, setFilter] = useState<"NEW" | "ALL">("NEW");
  const [openId, setOpenId] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const list = useQuery({
    queryKey: ["prescreening-list", filter],
    queryFn: () => api<{ submissions: SubmissionView[] }>(`/prescreening${filter === "NEW" ? "?status=NEW" : ""}`),
    select: (data) => data.submissions,
  });

  return (
    <div className="stack">
      <PageHead title="Precalificación" subtitle="Solicitudes que llegan por tu enlace. El sistema orienta; tú decides.">
        <Button variant="accent" onClick={() => setRegistering(true)}>
          Registrar solicitud por chat
        </Button>
      </PageHead>

      <div className="row" role="tablist" aria-label="Filtrar solicitudes">
        {(["NEW", "ALL"] as const).map((item) => (
          <button key={item} role="tab" aria-selected={filter === item} className={`btn small ${filter === item ? "" : "secondary"}`} onClick={() => setFilter(item)}>
            {item === "NEW" ? "Por revisar" : "Todas"}
          </button>
        ))}
      </div>

      <Card>
        {list.isPending ? (
          <Loading />
        ) : list.isError ? (
          <ErrorNotice error={list.error} />
        ) : list.data.length === 0 ? (
          <EmptyState title="No hay solicitudes por revisar">Comparte tu enlace por WhatsApp para recibir solicitudes.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Solicitante</th>
                  <th>Resultado</th>
                  <th className="num">Puntaje</th>
                  <th>Recibida</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button className="btn ghost small" style={{ padding: 0, textDecoration: "underline" }} onClick={() => setOpenId(item.id)}>
                        {item.applicantName}
                      </button>
                      <div className="muted small">{item.phone}</div>
                    </td>
                    <td>
                      <Badge tone={OUTCOME[item.outcome].tone}>{OUTCOME[item.outcome].label}</Badge>
                    </td>
                    <td className="num">{item.score}</td>
                    <td>{formatDate(item.receivedOn)}</td>
                    <td>{item.status === "NEW" ? <Badge tone="info">Por revisar</Badge> : <Badge>{item.decision === "CONTINUE" ? "Continúa" : "Descartada"}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <FormConfig />
      {registering ? <ManualEntryModal onClose={() => setRegistering(false)} /> : null}
      {openId ? <SubmissionModal id={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
