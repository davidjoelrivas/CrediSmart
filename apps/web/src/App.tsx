import { Navigate, Route, Routes } from "react-router-dom";
import { Layout, PortalLayout } from "./components/Layout";
import { Loading } from "./components/ui";
import { useAuth } from "./lib/auth";
import { AuditPage } from "./pages/AuditPage";
import { BorrowerDetailPage } from "./pages/BorrowerDetailPage";
import { BorrowersPage } from "./pages/BorrowersPage";
import { CollectionsPage } from "./pages/CollectionsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoanDetailPage } from "./pages/LoanDetailPage";
import { LoanNewPage } from "./pages/LoanNewPage";
import { LoansPage } from "./pages/LoansPage";
import { LoginPage } from "./pages/LoginPage";
import { ApplyPage } from "./pages/ApplyPage";
import { PrescreeningPage } from "./pages/PrescreeningPage";
import { PortalLoanPage, PortalPage } from "./pages/PortalPage";
import { SimulatorPage } from "./pages/SimulatorPage";
import { UsersPage } from "./pages/UsersPage";
import { VerifyPage } from "./pages/VerifyPage";

/** Primera pantalla según el rol: el cliente va a su portal; el personal, a su tablero o a lo que sí puede ver. */
function Home() {
  const { user, can } = useAuth();
  if (user?.role === "CLIENT") {
    return <Navigate to="/portal" replace />;
  }
  if (can("reports:read")) {
    return <DashboardPage />;
  }
  return <Navigate to="/clientes" replace />;
}

export function App() {
  const { user } = useAuth();

  return (
    <Routes>
      {/* Pública: cualquiera que escanee el QR de un recibo puede comprobarlo. */}
      <Route path="/verificar/:code" element={<VerifyPage />} />
      <Route path="/aplicar/:slug" element={<ApplyPage />} />
      <Route path="/login" element={user === undefined ? <Loading label="Abriendo CrediSmart…" /> : user ? <Navigate to="/" replace /> : <LoginPage />} />

      {user === undefined ? (
        <Route path="*" element={<Loading label="Abriendo CrediSmart…" />} />
      ) : user === null ? (
        <Route path="*" element={<Navigate to="/login" replace />} />
      ) : user.role === "CLIENT" ? (
        <Route element={<PortalLayout />}>
          <Route path="/portal" element={<PortalPage />} />
          <Route path="/portal/prestamos/:id" element={<PortalLoanPage />} />
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Route>
      ) : (
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="/clientes" element={<BorrowersPage />} />
          <Route path="/clientes/:id" element={<BorrowerDetailPage />} />
          <Route path="/prestamos" element={<LoansPage />} />
          <Route path="/prestamos/nuevo" element={<LoanNewPage />} />
          <Route path="/prestamos/:id" element={<LoanDetailPage />} />
          <Route path="/precalificacion" element={<PrescreeningPage />} />
          <Route path="/cobranza" element={<CollectionsPage />} />
          <Route path="/simulador" element={<SimulatorPage />} />
          <Route path="/bitacora" element={<AuditPage />} />
          <Route path="/usuarios" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}
