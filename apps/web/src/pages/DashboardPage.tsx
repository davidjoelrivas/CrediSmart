import type { AccrualResult } from "@app/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, ErrorNotice, Loading, PageHead, Stat, useToast } from "../components/ui";
import { api, messageOf } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PAYMENT_METHOD_LABELS, formatBp, formatCents, formatDate, formatDays, labelOf } from "../lib/format";
import { useDashboard } from "../lib/queries";

function CapitalBar({ cash, portfolio }: { cash: number; portfolio: number }) {
  const total = Math.max(cash, 0) + Math.max(portfolio, 0);
  const cashShare = total === 0 ? 0 : (Math.max(cash, 0) / total) * 100;
  return (
    <div>
      <div className="bar" role="img" aria-label={`Caja ${cashShare.toFixed(0)} %, cartera ${(100 - cashShare).toFixed(0)} %`}>
        <span style={{ width: `${cashShare}%`, background: "var(--accent)" }} />
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span>
          <i className="dot" style={{ background: "var(--accent)" }} />
          Caja y bancos {formatCents(cash)}
        </span>
        <span>
          <i className="dot" style={{ background: "var(--line)" }} />
          Prestado {formatCents(portfolio)}
        </span>
      </div>
    </div>
  );
}

function RiskBar({ label, basisPoints }: { label: string; basisPoints: number }) {
  return (
    <div>
      <div className="row spread small">
        <span>{label}</span>
        <strong>{formatBp(basisPoints)}</strong>
      </div>
      <div className={`bar${basisPoints >= 1000 ? " danger" : ""}`}>
        <span style={{ width: `${Math.min(basisPoints / 100, 100)}%` }} />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const dashboard = useDashboard();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const accrue = useMutation({
    mutationFn: () => api<AccrualResult>("/late-fees/accrue", { method: "POST", body: {} }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      toast(
        result.installmentsUpdated === 0
          ? "La mora ya estaba al día."
          : `Mora actualizada en ${result.loansUpdated} préstamo${result.loansUpdated === 1 ? "" : "s"}.`,
      );
    },
    onError: (error) => toast(messageOf(error), "danger"),
  });

  if (dashboard.isPending) {
    return <Loading />;
  }
  if (dashboard.isError) {
    return <ErrorNotice error={dashboard.error} />;
  }
  const data = dashboard.data;

  return (
    <div className="stack">
      <PageHead title="Tablero" subtitle={`Resumen de tu negocio al ${formatDate(data.asOf)}`}>
        {can("late-fees:run") ? (
          <Button variant="secondary" loading={accrue.isPending} onClick={() => accrue.mutate()}>
            Recalcular mora
          </Button>
        ) : null}
        {can("borrowers:write") ? (
          <Link className="btn secondary" to="/clientes">
            Nuevo cliente
          </Link>
        ) : null}
        {can("loans:approve") ? (
          <Link className="btn accent" to="/prestamos/nuevo">
            Nuevo préstamo
          </Link>
        ) : null}
      </PageHead>

      <div className="grid cols-4">
        <Stat hero label="Capital total" value={formatCents(data.capital.totalCents)} hint="Caja y bancos más lo prestado" />
        <Stat label="Intereses ganados" value={formatCents(data.income.interestCents)} hint={`Mora cobrada ${formatCents(data.income.lateFeeCents)}`} tone="ok" />
        <Stat label="Cobrado este mes" value={formatCents(data.income.collectedThisMonthCents)} hint="Pagos recibidos desde el día 1" />
        <Stat
          label="Vencido por cobrar"
          value={formatCents(data.risk.overdueAmountCents)}
          hint={`${data.risk.overdueLoans} préstamo${data.risk.overdueLoans === 1 ? "" : "s"} en mora`}
          tone={data.risk.overdueAmountCents > 0 ? "danger" : undefined}
        />
      </div>

      <div className="grid cols-2">
        <Card title="Dónde está tu dinero">
          <CapitalBar cash={data.capital.cashCents} portfolio={data.capital.portfolioCents} />
          <dl className="kv" style={{ marginTop: 16 }}>
            <dt>Préstamos activos</dt>
            <dd>{data.loans.active}</dd>
            <dt>Pendientes de firma</dt>
            <dd>{data.loans.pendingSignature}</dd>
            <dt>Terminados de pagar</dt>
            <dd>{data.loans.paidOff}</dd>
            <dt>Capital pendiente de cobro</dt>
            <dd>{formatCents(data.risk.outstandingPrincipalCents)}</dd>
          </dl>
        </Card>
        <Card title="Salud de la cartera">
          <div className="stack">
            <RiskBar label="Capital en riesgo a más de 7 días" basisPoints={data.risk.par7Bp} />
            <RiskBar label="Capital en riesgo a más de 30 días" basisPoints={data.risk.par30Bp} />
            <p className="muted small">
              Es la parte del capital pendiente que está en préstamos atrasados. Por debajo de 5 % se considera sana.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Más atrasados" action={<Link to="/cobranza">Ver cobranza</Link>}>
          {data.topOverdue.length === 0 ? (
            <EmptyState title="Nadie está atrasado">Todos los préstamos están al día.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th className="num">Atraso</th>
                    <th className="num">Debe</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topOverdue.map((row) => (
                    <tr key={row.loanId}>
                      <td>
                        <Link to={`/prestamos/${row.loanId}`}>{row.borrowerName}</Link>
                        <div className="muted small">{row.loanCode}</div>
                      </td>
                      <td className="num">
                        <Badge tone={row.daysOverdue > 30 ? "danger" : "warn"}>{formatDays(row.daysOverdue)}</Badge>
                      </td>
                      <td className="num">{formatCents(row.overdueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Próximos 7 días">
          {data.upcoming.length === 0 ? (
            <EmptyState title="Sin cuotas por vencer">No hay cuotas que venzan esta semana.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Vence</th>
                    <th className="num">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming.map((row) => (
                    <tr key={`${row.loanId}-${row.installmentNumber}`}>
                      <td>
                        <Link to={`/prestamos/${row.loanId}`}>{row.borrowerName}</Link>
                        <div className="muted small">
                          {row.loanCode} · cuota {row.installmentNumber}
                        </div>
                      </td>
                      <td>{formatDate(row.dueDate)}</td>
                      <td className="num">{formatCents(row.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Últimos pagos">
        {data.recentPayments.length === 0 ? (
          <EmptyState title="Todavía no hay pagos" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Préstamo</th>
                  <th>Forma</th>
                  <th className="num">Monto</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPayments.map((payment) => (
                  <tr key={payment.paymentId}>
                    <td>{formatDate(payment.receivedOn)}</td>
                    <td>{payment.borrowerName}</td>
                    <td>{payment.loanCode}</td>
                    <td>{labelOf(PAYMENT_METHOD_LABELS, payment.method)}</td>
                    <td className="num">
                      {payment.isReversal ? <Badge tone="danger">Reverso</Badge> : null} {formatCents(payment.amountCents)}
                    </td>
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
