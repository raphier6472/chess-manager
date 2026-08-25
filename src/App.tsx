import { Link, Outlet } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";

export default function App() {
  const { isOrganizer, logout } = useAuth();
  return (
    <>
      <header className="app-header">
        <Link to="/" className="app-header__mark">
          Torneo
        </Link>
        {isOrganizer ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={logout}>
            Cerrar sesión
          </button>
        ) : (
          <Link to="/login" className="btn btn--ghost btn--sm">
            Organizador
          </Link>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}
