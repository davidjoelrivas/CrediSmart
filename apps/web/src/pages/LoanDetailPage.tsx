import { PAYMENT_METHODS, type LoanDetailView, type PaymentResult, type PaymentView } from "@app/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { LoanStatusBadge } from "../components/loan-parts";
import { Badge, Button, Card, ErrorNotice, Field, Loading, Modal, MoneyInput, PageHead, Stat, useToast } from "../components/ui";
import { ApiError, api, newIdempotencyKey } from "../lib/api";
import { offlineQueue } from "../lib/offline-queue";
import { useAuth } from "../lib/auth";
import {
  FREQUENCY_ADJECTIVES,
  INSTALLMENT_STATUS_LABELS,
  INTEREST_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
  formatBp,
  formatCents,
  formatDate,
  labelOf,
} from "../lib/format";
import { centsToInput, parseLempiras } from "../lib/money-input";
import { useLoan } from "../lib/queries";

const receiptPdfUrl = (paymentId: string) => `/api/v1/payments/${paymentId}/receipt.pdf`;

function DisburseModal({ loan, onClose }: { loan: LoanDetailView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [method, setMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const disburse = useMutation({
    mutationFn: () => api(`/loans/${loan.id}/disburse`, { method: "POST", body: { method } }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast(`Se entregaron ${formatCents(loan.principalCents)} a ${loan.borrowerName}.`);
      onClose();
    },
  });

  return (
    <Modal title={`Desembolsar ${loan.code}`} onClose={onClose}>
      <div className="stack">
        {disburse.isError ? <ErrorNotice error={disburse.error} /> : null}
        <p>
          Vas a entregar <strong>{formatCents(loan.principalCents)}</strong> a <strong>{loan.borrowerName}</strong>. Confirma solo cuando el contrato ya esté firmado: esto mueve el dinero en tu contabilidad.
        </p>
        <Field label="¿De dónde sale el dinero?">
          {(props) => (
            <select {...props} value={method} onChange={(event) => setMethod(event.target.value as "CASH" | "TRANSFER")}>
              <option value="CASH">Efectivo (caja)</option>
              <option value="TRANSFER">Transferencia (bancos)</option>
            </select>
          )}
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="accent" loading={disburse.isPending} onClick={() => disburse.mutate()}>
            Confirmar desembolso
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({ loan, onClose }: { loan: LoanDetailView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Una clave por cada intento de cobro: si la red falla y se repite, el cobro no se duplica.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [amount, setAmount] = useState(centsToInput(Math.min(loan.nextDueCents, loan.outstandingCents)));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("CASH");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState(new Date().toLocaleDateString("en-CA"));
  const [done, setDone] = useState<PaymentResult | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const { user } = useAuth();

  const cents = parseLempiras(amount);
  const pay = useMutation({
    mutationFn: () =>
      api<PaymentResult>("/payments", {
        method: "POST",
        body: { loanId: loan.id, amountCents: cents, method, reference: reference || undefined, receivedOn, idempotencyKey },
        timeoutMs: 12_000,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      setDone(result);
    },
    onError: (error) => {
      // Sin internet: el cobro no se pierde. Se guarda en este equipo con la MISMA clave de idempotencia y se envía solo.
      if (error instanceof ApiError && error.status === 0 && user && cents) {
        offlineQueue.enqueue({
          id: idempotencyKey,
          userId: user.id,
          loanId: loan.id,
          loanCode: loan.code,
          borrowerName: loan.borrowerName,
          amountCents: cents,
          method,
          reference: reference || undefined,
          receivedOn,
        });
        setSavedOffline(true);
      }
    },
  });

  if (savedOffline) {
    return (
      <Modal title="Cobro guardado sin conexión" onClose={onClose}>
        <div className="stack">
          <div className="notice warn">
            No hay conexión con el servidor, pero <strong>el cobro de {formatCents(cents ?? 0)} quedó guardado en este equipo</strong>. Se enviará solo cuando vuelva el internet y entonces se emite el recibo.
          </div>
          <p className="muted small">No lo registres de nuevo: se enviaría dos veces. Puedes ver los cobros pendientes en el aviso de arriba.</p>
          <div className="modal-actions">
            <Button variant="accent" onClick={onClose}>
              Entendido
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  if (done) {
    return (
      <Modal title="Pago registrado" onClose={onClose}>
        <div className="stack">
          <div className="notice ok">
            Se recibieron {formatCents(cents ?? 0)}. Recibo REC-{String(done.receipt.folio).padStart(6, "0")} emitido.
          </div>
          {done.loanStatus === "PAID_OFF" ? <div className="notice ok">¡Este préstamo quedó totalmente pagado!</div> : null}
          <div className="modal-actions">
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            <a className="btn accent" href={receiptPdfUrl(done.paymentId)} target="_blank" rel="noreferrer">
              Ver recibo (PDF)
            </a>
          </div>
        </div>
      </Modal>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    pay.mutate();
  }

  return (
    <Modal title={`Registrar pago · ${loan.code}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {pay.isError ? <ErrorNotice error={pay.error} /> : null}
        <p className="muted">
          {loan.borrowerName} debe {formatCents(loan.outstandingCents)} en total. El pago se aplica primero a la cuota más antigua: mora, luego interés y luego capital.
        </p>
        <div className="form-grid">
          <Field label="Monto recibido" error={amount !== "" && cents === null ? "Escribe un monto válido, por ejemplo 2,750.00" : null}>
            {(props) => <MoneyInput {...props} value={amount} onChange={setAmount} />}
          </Field>
          <Field label="Forma de pago">
            {(props) => (
              <select {...props} value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
                {PAYMENT_METHODS.map((item) => (
                  <option key={item} value={item}>
                    {PAYMENT_METHOD_LABELS[item]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Fecha en que se recibió" hint="No puede ser futura">
            {(props) => <input {...props} type="date" value={receivedOn} max={new Date().toLocaleDateString("en-CA")} onChange={(event) => setReceivedOn(event.target.value)} />}
          </Field>
          {method !== "CASH" ? (
            <Field label="Referencia" hint="Número de transferencia o depósito">
              {(props) => <input {...props} value={reference} onChange={(event) => setReference(event.target.value)} />}
            </Field>
          ) : null}
        </div>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="accent" loading={pay.isPending} disabled={!cents || cents <= 0 || receivedOn === ""}>
            Registrar pago
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReverseModal({ payment, onClose }: { payment: PaymentView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const reverse = useMutation({
    mutationFn: () => api(`/payments/${payment.id}/reverse`, { method: "POST", body: { reason } }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast("Pago revertido. El recibo quedó anulado.");
      onClose();
    },
  });

  return (
    <Modal title="Revertir pago" onClose={onClose}>
      <div className="stack">
        {reverse.isError ? <ErrorNotice error={reverse.error} /> : null}
        <p>
          Se anulará el pago de <strong>{formatCents(payment.amountCents)}</strong> del {formatDate(payment.receivedOn)} y su recibo. El pago original no se borra: queda el registro del error y de la corrección.
        </p>
        <Field label="¿Por qué se revierte?" hint="Mínimo 5 caracteres. Queda en la bitácora.">
          {(props) => <textarea {...props} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" loading={reverse.isPending} disabled={reason.trim().length < 5} onClick={() => reverse.mutate()}>
            Revertir pago
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function LoanDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const loan = useLoan(id);
  const [modal, setModal] = useState<"disburse" | "pay" | { reverse: PaymentView } | null>(null);

  if (loan.isPending) {
    return <Loading />;
  }
  if (loan.isError) {
    return <ErrorNotice error={loan.error} />;
  }
  const data = loan.data;
  const close = () => setModal(null);

  return (
    <div className="stack">
      <PageHead
        title={`${data.code} · ${data.borrowerName}`}
        subtitle={
          <>
            <Link to="/prestamos">← Préstamos</Link> · <Link to={`/clientes/${data.borrowerId}`}>Ver cliente</Link>
          </>
        }
      >
        <LoanStatusBadge status={data.status} daysOverdue={data.daysOverdue} />
        {can("loans:approve") ? (
          <a className="btn secondary" href={`/api/v1/loans/${data.id}/contract.pdf`} target="_blank" rel="noreferrer">
            Contrato y pagaré
          </a>
        ) : null}
        {data.status === "PENDING_SIGNATURE" && can("loans:disburse") ? (
          <Button variant="accent" onClick={() => setModal("disburse")}>
            Desembolsar
          </Button>
        ) : null}
        {data.status === "ACTIVE" && can("payments:register") ? (
          <Button variant="accent" onClick={() => setModal("pay")}>
            Registrar pago
          </Button>
        ) : null}
      </PageHead>

      <div className="grid cols-4">
        <Stat label="Monto prestado" value={formatCents(data.principalCents)} hint={`${data.installments} cuotas`} />
        <Stat label="Debe en total" value={formatCents(data.outstandingCents)} hint="Capital, interés y mora" />
        <Stat label="Próxima cuota" value={data.nextDueDate ? formatDate(data.nextDueDate) : "—"} hint={data.nextDueDate ? formatCents(data.nextDueCents) : undefined} tone={data.daysOverdue > 0 ? "danger" : undefined} />
        <Stat label="Tasa efectiva anual" value={formatBp(data.aprBp)} hint="Costo real en un año" />
      </div>

      <div className="grid cols-2">
        <Card title="Condiciones pactadas">
          <dl className="kv">
            <dt>Tasa</dt>
            <dd>
              {formatBp(data.terms.rateBp)} {FREQUENCY_ADJECTIVES[data.terms.ratePeriod]}
            </dd>
            <dt>Pagos</dt>
            <dd>{labelOf({ WEEKLY: "Semanales", BIWEEKLY: "Quincenales", MONTHLY: "Mensuales" }, data.terms.paymentFrequency)}</dd>
            <dt>Cálculo</dt>
            <dd>{labelOf(INTEREST_METHOD_LABELS, data.terms.interestMethod)}</dd>
            <dt>Inicio</dt>
            <dd>{formatDate(data.terms.startDate)}</dd>
            <dt>Desembolso</dt>
            <dd>{data.disbursedOn ? formatDate(data.disbursedOn) : "Pendiente"}</dd>
          </dl>
        </Card>
        <Card title="Mora">
          <dl className="kv">
            <dt>Política</dt>
            <dd>{data.lateFee.description}</dd>
            <dt>Días de gracia</dt>
            <dd>{data.lateFee.graceDays}</dd>
            {data.aprCapOverrideReason ? (
              <>
                <dt>Sobre el tope legal</dt>
                <dd>{data.aprCapOverrideReason}</dd>
              </>
            ) : null}
          </dl>
        </Card>
      </div>

      <Card title="Plan de cuotas">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Vence</th>
                <th>Estado</th>
                <th className="num">Capital</th>
                <th className="num">Interés</th>
                <th className="num">Mora</th>
                <th className="num">Pagado</th>
                <th className="num">Falta</th>
              </tr>
            </thead>
            <tbody>
              {data.installmentsDetail.map((row) => (
                <tr key={row.number} className={row.isOverdue ? "is-overdue" : undefined}>
                  <td>{row.number}</td>
                  <td>{formatDate(row.dueDate)}</td>
                  <td>
                    <Badge tone={row.status === "PAID" ? "ok" : row.isOverdue ? "danger" : row.status === "PARTIAL" ? "warn" : "neutral"}>
                      {row.isOverdue && row.status !== "PAID" ? "Vencida" : labelOf(INSTALLMENT_STATUS_LABELS, row.status)}
                    </Badge>
                  </td>
                  <td className="num">{formatCents(row.principalDueCents)}</td>
                  <td className="num">{formatCents(row.interestDueCents)}</td>
                  <td className="num">{row.lateFeeDueCents > 0 ? formatCents(row.lateFeeDueCents) : "—"}</td>
                  <td className="num">{formatCents(row.paidCents)}</td>
                  <td className="num">
                    <strong>{formatCents(row.outstandingCents)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Pagos y recibos">
        {data.payments.length === 0 ? (
          <p className="muted">Todavía no hay pagos registrados.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Forma</th>
                  <th>Recibo</th>
                  <th className="num">Monto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatDate(payment.receivedOn)}</td>
                    <td>
                      {labelOf(PAYMENT_METHOD_LABELS, payment.method)}
                      {payment.reference ? <div className="muted small">Ref. {payment.reference}</div> : null}
                      {payment.reversalReason ? <div className="muted small">Motivo: {payment.reversalReason}</div> : null}
                    </td>
                    <td>
                      {payment.isReversal ? (
                        <Badge tone="danger">Reverso</Badge>
                      ) : payment.receiptFolio ? (
                        <>
                          <a href={receiptPdfUrl(payment.id)} target="_blank" rel="noreferrer">
                            {payment.receiptFolio}
                          </a>{" "}
                          {payment.reversed ? <Badge tone="danger">Anulado</Badge> : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">{formatCents(payment.amountCents)}</td>
                    <td className="num">
                      {!payment.isReversal && !payment.reversed && can("payments:reverse") ? (
                        <Button variant="ghost" small onClick={() => setModal({ reverse: payment })}>
                          Revertir
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal === "disburse" ? <DisburseModal loan={data} onClose={close} /> : null}
      {modal === "pay" ? <PaymentModal loan={data} onClose={close} /> : null}
      {typeof modal === "object" && modal !== null ? <ReverseModal payment={modal.reverse} onClose={close} /> : null}
    </div>
  );
}
