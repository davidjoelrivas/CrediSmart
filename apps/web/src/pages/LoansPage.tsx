import { useState } from "react";
import { Link } from "react-router-dom";
import { LoansTable } from "../components/loan-parts";
import { Card, ErrorNotice, Loading, PageHead } from "../components/ui";
import { useAuth } from "../lib/auth";
import { useLoans, type LoanFilter } from "../lib/queries";

const TABS: Array<{ id: string; label: string; filter: LoanFilter }> = [
  { id: "all", label: "Todos", filter: {} },
  { id: "active", label: "Activos", filter: { status: "ACTIVE" } },
  { id: "overdue", label: "En mora", filter: { overdue: true } },
  { id: "pending", label: "Pendientes de firma", filter: { status: "PENDING_SIGNATURE" } },
  { id: "paid", label: "Pagados", filter: { status: "PAID_OFF" } },
];

export function LoansPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState(TABS[0]!);
  const loans = useLoans(tab.filter);

  return (
    <div className="stack">
      <PageHead title="Préstamos" subtitle="Todos los créditos, de la aprobación al último pago.">
        {can("loans:simulate") ? (
          <Link className="btn secondary" to="/simulador">
            Simulador
          </Link>
        ) : null}
        {can("loans:approve") ? (
          <Link className="btn accent" to="/prestamos/nuevo">
            Nuevo préstamo
          </Link>
        ) : null}
      </PageHead>

      <div className="row" role="tablist" aria-label="Filtrar préstamos">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={item.id === tab.id}
            className={`btn small ${item.id === tab.id ? "" : "secondary"}`}
            onClick={() => setTab(item)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Card>
        {loans.isPending ? <Loading /> : loans.isError ? <ErrorNotice error={loans.error} /> : <LoansTable loans={loans.data} />}
      </Card>
    </div>
  );
}
