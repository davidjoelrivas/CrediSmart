import type { LoanStatusName, LoanSummaryView } from "@app/contracts";
import { Link } from "react-router-dom";
import { formatBp, formatCents, formatDate, formatDays, LOAN_STATUS_LABELS, labelOf } from "../lib/format";
import { Badge, EmptyState, type Tone } from "./ui";

const STATUS_TONES: Record<LoanStatusName, Tone> = {
  PENDING_SIGNATURE: "info",
  ACTIVE: "ok",
  PAID_OFF: "neutral",
  WRITTEN_OFF: "danger",
  CANCELLED: "neutral",
};

export function LoanStatusBadge({ status, daysOverdue = 0 }: { status: LoanStatusName; daysOverdue?: number }) {
  if (status === "ACTIVE" && daysOverdue > 0) {
    return <Badge tone={daysOverdue > 30 ? "danger" : "warn"}>En mora · {formatDays(daysOverdue)}</Badge>;
  }
  return <Badge tone={STATUS_TONES[status]}>{labelOf(LOAN_STATUS_LABELS, status)}</Badge>;
}

export function LoansTable({
  loans,
  hrefBase = "/prestamos",
  showBorrower = true,
}: {
  loans: LoanSummaryView[];
  hrefBase?: string;
  showBorrower?: boolean;
}) {
  if (loans.length === 0) {
    return <EmptyState title="No hay préstamos para mostrar" />;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Código</th>
            {showBorrower ? <th>Cliente</th> : null}
            <th>Estado</th>
            <th className="num">Monto</th>
            <th className="num">Debe</th>
            <th>Próxima cuota</th>
            <th className="num">Tasa anual efectiva</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((loan) => (
            <tr key={loan.id}>
              <td>
                <Link to={`${hrefBase}/${loan.id}`}>{loan.code}</Link>
              </td>
              {showBorrower ? <td>{loan.borrowerName}</td> : null}
              <td>
                <LoanStatusBadge status={loan.status} daysOverdue={loan.daysOverdue} />
              </td>
              <td className="num">{formatCents(loan.principalCents)}</td>
              <td className="num">{formatCents(loan.outstandingCents)}</td>
              <td>
                {loan.nextDueDate ? (
                  <>
                    {formatDate(loan.nextDueDate)}
                    <div className="muted small">{formatCents(loan.nextDueCents)}</div>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="num">{formatBp(loan.aprBp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
