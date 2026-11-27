import type { LoanDetailView, LoanSummaryView } from "@app/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { LoanStatusBadge, LoansTable } from "../components/loan-parts";
import { Badge, Card, ErrorNotice, Loading, PageHead, Stat } from "../components/ui";
import { api } from "../lib/api";
import { INSTALLMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS, formatCents, formatDate, labelOf } from "../lib/format";
import { keys } from "../lib/queries";

/** Lo que ve el cliente final: sus préstamos, cuánto debe y cuándo paga. Nada de otros clientes. */
export function PortalPage() {
  const loans = useQuery({
    queryKey: keys.portalLoans,
    queryFn: () => api<{ loans: LoanSummaryView[] }>("/portal/loans"),
    select: (data) => data.loans,
  });

  if (loans.isPending) {
    return <Loading />;
  }
  if (loans.isError) {
    return <ErrorNotice error={loans.error} />;
  }
  const active = loans.data.filter((loan) => loan.status === "ACTIVE");
  const owed = active.reduce((sum, loan) => sum + loan.outstandingCents, 0);
  const next = active.filter((loan) => loan.nextDueDate).sort((a, b) => a.nextDueDate!.localeCompare(b.nextDueDate!))[0];

  return (
    <div className="stack">
      <PageHead title="Mis préstamos" subtitle="Consulta cuánto debes y cuándo toca pagar." />
      <div className="grid cols-3">
        <Stat label="Debes en total" value={formatCents(owed)} />
        <Stat label="Próximo pago" value={next ? formatDate(next.nextDueDate) : "—"} hint={next ? formatCents(next.nextDueCents) : "Estás al día"} />
        <Stat label="Préstamos activos" value={active.length} />
      </div>
      <Card>
        <LoansTable loans={loans.data} hrefBase="/portal/prestamos" showBorrower={false} />
      </Card>
    </div>
  );
}

export function PortalLoanPage() {
  const { id = "" } = useParams();
  const loan = useQuery({
    queryKey: ["portal-loan", id],
    queryFn: () => api<{ loan: LoanDetailView }>(`/portal/loans/${id}`),
    select: (data) => data.loan,
  });

  if (loan.isPending) {
    return <Loading />;
  }
  if (loan.isError) {
    return <ErrorNotice error={loan.error} />;
  }
  const data = loan.data;

  return (
    <div className="stack">
      <PageHead title={`Préstamo ${data.code}`} subtitle={<Link to="/portal">← Mis préstamos</Link>}>
        <LoanStatusBadge status={data.status} daysOverdue={data.daysOverdue} />
      </PageHead>
      <div className="grid cols-3">
        <Stat label="Monto prestado" value={formatCents(data.principalCents)} />
        <Stat label="Debes" value={formatCents(data.outstandingCents)} />
        <Stat label="Próxima cuota" value={data.nextDueDate ? formatDate(data.nextDueDate) : "—"} hint={data.nextDueDate ? formatCents(data.nextDueCents) : undefined} tone={data.daysOverdue > 0 ? "danger" : undefined} />
      </div>
      <Card title="Tus cuotas">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Vence</th>
                <th>Estado</th>
                <th className="num">Cuota</th>
                <th className="num">Falta</th>
              </tr>
            </thead>
            <tbody>
              {data.installmentsDetail.map((row) => (
                <tr key={row.number} className={row.isOverdue ? "is-overdue" : undefined}>
                  <td>{row.number}</td>
                  <td>{formatDate(row.dueDate)}</td>
                  <td>
                    <Badge tone={row.status === "PAID" ? "ok" : row.isOverdue ? "danger" : "neutral"}>
                      {row.isOverdue && row.status !== "PAID" ? "Vencida" : labelOf(INSTALLMENT_STATUS_LABELS, row.status)}
                    </Badge>
                  </td>
                  <td className="num">{formatCents(row.principalDueCents + row.interestDueCents + row.lateFeeDueCents)}</td>
                  <td className="num">{formatCents(row.outstandingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Tus pagos">
        {data.payments.length === 0 ? (
          <p className="muted">Aún no has hecho pagos.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Forma</th>
                  <th>Recibo</th>
                  <th className="num">Monto</th>
                </tr>
              </thead>
              <tbody>
                {data.payments
                  .filter((payment) => !payment.isReversal)
                  .map((payment) => (
                    <tr key={payment.id}>
                      <td>{formatDate(payment.receivedOn)}</td>
                      <td>{labelOf(PAYMENT_METHOD_LABELS, payment.method)}</td>
                      <td>{payment.receiptFolio ?? "—"}</td>
                      <td className="num">{formatCents(payment.amountCents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
