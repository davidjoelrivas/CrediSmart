import type { ReceiptVerification } from "@app/contracts";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Loading } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { formatCents, formatDate } from "../lib/format";

/** Página pública a la que lleva el QR del recibo: confirma si es auténtico sin pedir inicio de sesión. */
export function VerifyPage() {
  const { code = "" } = useParams();
  const result = useQuery({
    queryKey: ["verify", code],
    queryFn: () => api<ReceiptVerification>(`/public/receipts/${encodeURIComponent(code)}`),
    retry: false,
  });

  if (result.isPending) {
    return <Loading label="Verificando recibo…" />;
  }

  const notFound = result.isError && result.error instanceof ApiError && result.error.status === 404;
  if (result.isError && !notFound) {
    return (
      <div className="verify">
        <div className="card verify-card stack">
          <div className="notice danger">No se pudo verificar ahora mismo. Intenta de nuevo en unos minutos.</div>
        </div>
      </div>
    );
  }

  const receipt = result.data;
  const valid = receipt?.valid === true;

  return (
    <div className="verify">
      <section className="card verify-card stack" aria-live="polite">
        <div>
          <div className={`verify-icon ${valid ? "ok" : "bad"}`} aria-hidden="true">
            {valid ? "✓" : "✕"}
          </div>
          <h1 style={{ textAlign: "center", fontSize: "1.35rem" }}>
            {valid ? "Recibo auténtico" : receipt?.voided ? "Recibo anulado" : "Recibo no encontrado"}
          </h1>
          <p className="muted" style={{ textAlign: "center", marginTop: 6 }}>
            {valid
              ? "Este comprobante fue emitido por el sistema y sigue vigente."
              : receipt?.voided
                ? "Este recibo existió, pero el pago fue revertido. Ya no tiene validez."
                : "El código no corresponde a ningún recibo emitido. Desconfía de este documento."}
          </p>
        </div>
        {receipt ? (
          <dl className="kv">
            <dt>Emitido por</dt>
            <dd>{receipt.organizationName}</dd>
            <dt>Folio</dt>
            <dd>{receipt.folio}</dd>
            <dt>Cliente</dt>
            <dd>{receipt.borrowerHint}</dd>
            <dt>Monto</dt>
            <dd>{formatCents(receipt.amountCents)}</dd>
            <dt>Fecha del pago</dt>
            <dd>{formatDate(receipt.receivedOn)}</dd>
            <dt>Emitido el</dt>
            <dd>{formatDate(receipt.issuedOn)}</dd>
          </dl>
        ) : null}
        <p className="muted small" style={{ textAlign: "center" }}>
          Por privacidad solo se muestra lo necesario para comprobar el recibo. CrediSmart
        </p>
      </section>
    </div>
  );
}
