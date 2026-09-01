import { useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import ThemeToggle from "./ThemeToggle";
import { QueenIcon } from "./icons/QueenIcon";

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isOrganizer, organizerName, logout } = useAuth();
  const location = useLocation();

  // Navegar (en móvil) cierra el drawer, así no queda tapando la página nueva.
  useEffect(() => {
    onClose();
  }, [location.pathname, onClose]);

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
        <Link to="/" className="sidebar__mark">
          <QueenIcon />
          Torneo
        </Link>

        <nav className="sidebar__nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            Torneos
          </NavLink>
          <NavLink to="/campeonato" className={({ isActive }) => (isActive ? "active" : "")}>
            Campeonato
          </NavLink>
        </nav>

        <div className="sidebar__footer">
          <ThemeToggle />
          {isOrganizer ? (
            <div className="sidebar__organizer">
              <div className="sidebar__organizer-name">{organizerName ?? "Organizador"}</div>
              {organizerName && <div className="sidebar__organizer-role">Organizador</div>}
              <button type="button" className="btn btn--ghost btn--sm" onClick={logout}>
                Cerrar sesión
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn btn--ghost btn--sm">
              Organizador
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
