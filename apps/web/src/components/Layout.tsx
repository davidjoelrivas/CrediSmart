import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ROLE_LABELS, labelOf } from "../lib/format";
import { Button, Icon } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  permission: string;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Tablero", icon: "dashboard", permission: "reports:read", end: true },
  { to: "/clientes", label: "Clientes", icon: "users", permission: "borrowers:read" },
  { to: "/prestamos", label: "Préstamos", icon: "loans", permission: "loans:read" },
  { to: "/precalificacion", label: "Solicitudes", icon: "inbox", permission: "prescreening:read" },
  { to: "/cobranza", label: "Cobranza", icon: "alert", permission: "loans:read" },
  { to: "/simulador", label: "Simulador", icon: "calc", permission: "loans:simulate" },
  { to: "/bitacora", label: "Bitácora", icon: "shield", permission: "audit:read" },
  { to: "/usuarios", label: "Equipo", icon: "team", permission: "users:manage" },
];

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#14595a" />
      <path d="M38 20a14 14 0 1 0 0 24" fill="none" stroke="#7ee0c3" strokeWidth="7" strokeLinecap="round" />
      <circle cx="43" cy="32" r="4" fill="#7ee0c3" />
    </svg>
  );
}

export function Layout() {
  const { user, can, logout } = useAuth();
  const items = NAV.filter((item) => can(item.permission));

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="/">
          <BrandMark />
          CrediSmart
        </a>
        <nav className="nav" aria-label="Principal">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <strong>{user?.fullName}</strong>
          <span>{user ? labelOf(ROLE_LABELS, user.role) : ""}</span>
          <Button variant="ghost" small onClick={() => void logout()}>
            Cerrar sesión
          </Button>
        </div>
      </aside>
      <div>
        <div className="mobile-bar">
          <strong>CrediSmart</strong>
          <Button variant="ghost" small onClick={() => void logout()} style={{ color: "#fff" }}>
            Salir
          </Button>
        </div>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Pantalla del cliente final: sin menú de gestión, solo lo suyo. */
export function PortalLayout() {
  const { user, logout } = useAuth();
  return (
    <div>
      <div className="mobile-bar" style={{ display: "flex" }}>
        <strong>CrediSmart</strong>
        <span className="row">
          <span className="small">{user?.fullName}</span>
          <Button variant="ghost" small onClick={() => void logout()} style={{ color: "#fff" }}>
            Salir
          </Button>
        </span>
      </div>
      <main className="main" style={{ margin: "0 auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
