import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { Tournament } from "../types";

const STATUS_LABEL: Record<Tournament["status"], string> = {
  setup: "sin empezar",
  active: "en curso",
  completed: "terminado",
};

export interface TournamentContext {
  tournament: Tournament;
  reload: () => void;
}

export default function TournamentShell() {
  const { isOrganizer } = useAuth();
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!tournamentId) return;
    api
      .getTournament(tournamentId)
      .then(setTournament)
      .catch((e) => setError(e.message));
  }, [tournamentId]);

  useEffect(load, [load]);

  if (error) return <p className="form-error">{error}</p>;
  if (!tournament) return null;

  const removeTournament = async () => {
    if (!confirm(`¿Eliminar "${tournament.name}" y todos sus datos?`)) return;
    await api.deleteTournament(tournament.id);
    navigate("/");
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {tournament.date} · {tournament.numRounds} rondas ·{" "}
            <span className={`badge ${tournament.status === "active" ? "badge--active" : tournament.status === "completed" ? "badge--completed" : ""}`}>
              {STATUS_LABEL[tournament.status]}
            </span>
          </p>
          <h1>{tournament.name}</h1>
        </div>
        {isOrganizer && (
          <button type="button" className="btn btn--danger btn--sm" onClick={removeTournament}>
            Eliminar torneo
          </button>
        )}
      </div>

      <nav className="tabs">
        <NavLink to="players" className={({ isActive }) => (isActive ? "active" : "")}>
          Jugadores
        </NavLink>
        <NavLink to="round" className={({ isActive }) => (isActive ? "active" : "")}>
          Ronda
        </NavLink>
        <NavLink to="standings" className={({ isActive }) => (isActive ? "active" : "")}>
          Posiciones
        </NavLink>
      </nav>

      <Outlet context={{ tournament, reload: load } satisfies TournamentContext} />
    </div>
  );
}
