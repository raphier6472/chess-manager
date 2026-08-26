import { Link, Outlet } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import ThemeToggle from "./ThemeToggle";

export default function App() {
  const { isOrganizer, logout } = useAuth();
  return (
    <>
      <header className="app-header">
        <Link to="/" className="app-header__mark">
          Torneo
        </Link>
        <div className="app-header__actions">
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
