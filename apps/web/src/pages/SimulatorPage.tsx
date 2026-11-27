import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_TERMS, SimulationResult, TermsFields, termsRequestOf, today, useSimulation, type TermsValues } from "../components/TermsForm";
import { Card, PageHead } from "../components/ui";
import { useAuth } from "../lib/auth";

/** Calcula cómo quedaría un préstamo sin guardar nada: ideal para mostrarle opciones al cliente. */
export function SimulatorPage() {
  const { can } = useAuth();
  const [values, setValues] = useState<TermsValues>({ ...DEFAULT_TERMS, startDate: today() });
  const terms = useMemo(() => termsRequestOf(values), [values]);
  const simulation = useSimulation(terms);

  return (
    <div className="stack">
      <PageHead title="Simulador" subtitle="Prueba montos, tasas y plazos. No se guarda nada.">
        {can("loans:approve") ? (
          <Link className="btn accent" to="/prestamos/nuevo">
            Crear préstamo real
          </Link>
        ) : null}
      </PageHead>
      <Card title="Condiciones">
        <TermsFields values={values} onChange={setValues} />
      </Card>
      <SimulationResult terms={terms} simulation={simulation} />
    </div>
  );
}
