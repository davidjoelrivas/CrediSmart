import { Badge, Card, EmptyState, ErrorNotice, Loading, PageHead } from "../components/ui";
import { AUDIT_ACTION_LABELS, formatDate, labelOf } from "../lib/format";
import { useAudit } from "../lib/queries";

function detailsText(details: Record<string, string | number | boolean | null>): string {
  return Object.entries(details)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${typeof value === "number" && key.endsWith("Cents") ? (value / 100).toFixed(2) : value}`)
    .join(" · ");
}

/** Historial de todo lo importante que pasó, con la comprobación de que nadie lo alteró. */
export function AuditPage() {
  const audit = useAudit();

  return (
    <div className="stack">
      <PageHead title="Bitácora" subtitle="Cada aprobación, desembolso, pago y corrección queda registrado y encadenado." />
      {audit.isPending ? (
        <Loading />
      ) : audit.isError ? (
        <ErrorNotice error={audit.error} />
      ) : (
        <>
          {audit.data.chainValid ? (
            <div className="notice ok">
              Integridad verificada: los registros están encadenados con huellas digitales y ninguno fue modificado ni borrado.
            </div>
          ) : (
            <div className="notice danger" role="alert">
              ¡Atención! La cadena de registros se rompe en el evento {audit.data.brokenAtSequence}. Alguien pudo alterar la bitácora: avisa al administrador del sistema.
            </div>
          )}
          <Card title="Últimos 100 eventos">
            {audit.data.records.length === 0 ? (
              <EmptyState title="Aún no hay eventos" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Evento</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.data.records.map((record, index) => (
                      <tr key={`${record.entityId}-${record.action}-${index}`}>
                        <td>{formatDate(record.on)}</td>
                        <td>
                          <Badge tone="info">{labelOf(AUDIT_ACTION_LABELS, record.action)}</Badge>
                        </td>
                        <td className="muted small">{detailsText(record.details)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
