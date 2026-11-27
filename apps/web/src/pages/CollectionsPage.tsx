import type { BorrowerView } from "@app/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LoanStatusBadge } from "../components/loan-parts";
import { Card, EmptyState, ErrorNotice, Loading, PageHead, Stat } from "../components/ui";
import { api } from "../lib/api";
import { formatCents, formatDate, whatsappLink } from "../lib/format";
import { useLoans } from "../lib/queries";

/** Lista de trabajo del cobrador: a quién llamar hoy, ordenado por gravedad, con el mensaje de WhatsApp ya escrito. */
export function CollectionsPage() {
  const overdue = useLoans({ overdue: true });
  const borrowers = useQuery({
    queryKey: ["borrowers", "", "cobranza"],
    queryFn: () => api<{ borrowers: BorrowerView[] }>("/borrowers?limit=200"),
    select: (data) => new Map(data.borrowers.map((borrower) => [borrower.id, borrower])),
  });

  if (overdue.isPending) {
    return <Loading />;
  }
  if (overdue.isError) {
    return <ErrorNotice error={overdue.error} />;
  }
  const loans = [...overdue.data].sort((first, second) => second.daysOverdue - first.daysOverdue);
  const totalOutstanding = loans.reduce((sum, loan) => sum + loan.outstandingCents, 0);

  return (
    <div className="stack">
      <PageHead title="Cobranza" subtitle="Préstamos atrasados, del más urgente al menos urgente." />

      <div className="grid cols-3">
        <Stat label="Préstamos en mora" value={loans.length} tone={loans.length > 0 ? "danger" : "ok"} />
        <Stat label="Saldo total de esos préstamos" value={formatCents(totalOutstanding)} />
        <Stat label="Mayor atraso" value={loans[0] ? `${loans[0].daysOverdue} días` : "—"} />
      </div>

      <Card>
        {loans.length === 0 ? (
          <EmptyState title="Todo al día">Ningún préstamo tiene cuotas vencidas.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Estado</th>
                  <th>Cuota vencida</th>
                  <th className="num">Debe en total</th>
                  <th>Contactar</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => {
                  const borrower = borrowers.data?.get(loan.borrowerId);
                  const first = loan.borrowerName.split(" ")[0];
                  const link = whatsappLink(
                    borrower?.phone ?? null,
                    `Hola ${first}, te recordamos que tu préstamo ${loan.code} tiene una cuota vencida desde el ${formatDate(loan.nextDueDate)} por ${formatCents(loan.nextDueCents)}. ¿Cuándo podrías ponerte al día? Gracias.`,
                  );
                  return (
                    <tr key={loan.id} className={loan.daysOverdue > 30 ? "is-overdue" : undefined}>
                      <td>
                        <Link to={`/clientes/${loan.borrowerId}`}>{loan.borrowerName}</Link>
                        <div className="muted small">
                          <Link to={`/prestamos/${loan.id}`}>{loan.code}</Link> {borrower?.phone ? `· ${borrower.phone}` : ""}
                        </div>
                      </td>
                      <td>
                        <LoanStatusBadge status={loan.status} daysOverdue={loan.daysOverdue} />
                      </td>
                      <td>
                        {formatDate(loan.nextDueDate)}
                        <div className="muted small">{formatCents(loan.nextDueCents)}</div>
                      </td>
                      <td className="num">{formatCents(loan.outstandingCents)}</td>
                      <td>
                        {link ? (
                          <a className="btn secondary small" href={link} target="_blank" rel="noreferrer">
                            Recordar por WhatsApp
                          </a>
                        ) : (
                          <span className="muted small">Sin teléfono</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
