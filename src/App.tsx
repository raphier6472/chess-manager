import { useCallback, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { QueenIcon } from "./icons/QueenIcon";

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
      <path stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M3 5.5h14M3 10h14M3 14.5h14" />
    </svg>
  );
}

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Identidad estable: Sidebar depende de esta función en un efecto (cierra el drawer
  // al navegar), y una función nueva en cada render de App reactivaría ese efecto cada
  // vez que drawerOpen cambia, cerrando el drawer apenas se abría.
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <div className="app-shell">
      <Sidebar open={drawerOpen} onClose={closeDrawer} />
      <div className="app-content">
        <header className="mobile-topbar">
          <button
            type="button"
            className="hamburger-btn"
            aria-label="Abrir menú"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <HamburgerIcon />
          </button>
          <Link to="/" className="mobile-topbar__mark">
            <QueenIcon />
            Torneo
          </Link>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
