import { Link, Outlet } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import ThemeToggle from "./ThemeToggle";

/** Reina estilizada: 5 bolas de corona sobre un cuerpo en forma de copa. */
function QueenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="7" r="1.3" />
      <circle cx="9.5" cy="5.5" r="1.3" />
      <circle cx="12" cy="5" r="1.3" />
      <circle cx="14.5" cy="5.5" r="1.3" />
      <circle cx="18" cy="7" r="1.3" />
      <rect x="5" y="8.3" width="14" height="1.6" rx="0.8" />
      <polygon points="6,9.9 18,9.9 14.5,14 9.5,14" />
      <polygon points="9.5,14 14.5,14 18,17.5 6,17.5" />
      <rect x="4" y="17.5" width="16" height="2" rx="1" />
    </svg>
  );
}

export default function App() {
  const { isOrganizer, logout } = useAuth();
  return (
    <>
      <header className="app-header">
        <Link to="/" className="app-header__mark">
          <QueenIcon />
          Torneo
        </Link>
        <div className="app-header__actions">
          <Link to="/campeonato" className="btn btn--ghost btn--sm">
            Campeonato
          </Link>
          <ThemeToggle />
          {isOrganizer ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={logout}>
              Cerrar sesión
            </button>
          ) : (
            <Link to="/login" className="btn btn--ghost btn--sm">
              Organizador
            </Link>
          )}
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}
