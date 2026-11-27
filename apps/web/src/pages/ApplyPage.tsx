import type { PublicFormView } from "@app/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { ApplicationForm } from "../components/ApplicationForm";
import { Loading } from "../components/ui";
import { ApiError, api } from "../lib/api";

/** Página pública (sin sesión): la persona interesada llena las preguntas del negocio desde su teléfono. */
export function ApplyPage() {
  const { slug = "" } = useParams();
  const form = useQuery({
    queryKey: ["apply", slug],
    queryFn: () => api<PublicFormView>(`/public/apply/${encodeURIComponent(slug)}`),
    retry: false,
  });
  const [sent, setSent] = useState(false);

  const submit = useMutation({
    mutationFn: (body: object) => api(`/public/apply/${encodeURIComponent(slug)}`, { method: "POST", body }),
    onSuccess: () => setSent(true),
  });

  if (form.isPending) {
    return <Loading />;
  }
  if (form.isError) {
    const missing = form.error instanceof ApiError && form.error.status === 404;
    return (
      <div className="verify">
        <div className="card verify-card">
          <div className="notice danger">{missing ? "Este enlace no existe o ya no está activo." : "No se pudo abrir el formulario. Intenta de nuevo."}</div>
        </div>
      </div>
    );
  }
  const data = form.data;

  if (sent) {
    return (
      <div className="verify">
        <section className="card verify-card stack" aria-live="polite">
          <div className="verify-icon ok" aria-hidden="true">
            ✓
          </div>
          <h1 style={{ textAlign: "center", fontSize: "1.35rem" }}>¡Recibimos tu solicitud!</h1>
          <p className="muted" style={{ textAlign: "center" }}>
            {data.organizationName} revisará tus respuestas y te contactará por teléfono o WhatsApp. Esto no es una aprobación: la decisión la toma una persona.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="verify" style={{ alignItems: "start" }}>
      <div className="card verify-card stack">
        <div>
          <h1 style={{ fontSize: "1.35rem" }}>Solicita tu préstamo</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            {data.organizationName} · Responde unas preguntas rápidas. Toma menos de 2 minutos.
          </p>
        </div>
        <ApplicationForm
          questions={data.questions}
          consentText={`Autorizo que ${data.organizationName} guarde mis datos para evaluar mi solicitud.`}
          submitLabel="Enviar solicitud"
          pending={submit.isPending}
          error={submit.error}
          onSubmit={(body) => submit.mutate(body)}
          footer={<p className="muted small">Responder no garantiza un préstamo. Tus datos no se comparten con nadie.</p>}
        />
      </div>
    </div>
  );
}
