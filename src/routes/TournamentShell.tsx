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
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  /** Un torneo en curso pierde partidas ya jugadas: la confirmación dice cuántas. */
  const confirmMessage = async () => {
    const base = `¿Eliminar "${tournament.name}" y todos sus datos?`;
    if (tournament.status !== "active" || !tournamentId) return base;
    try {
      const rounds = await api.listRounds(tournamentId);
      // Solo resultados que cargó el organizador: el bye lo asigna el sistema al
      // emparejar, contarlo acá inflaría el número y confundiría el aviso.
      const played = rounds.reduce(
        (n, r) => n + r.matches.filter((m) => m.blackId !== null && m.result !== "unplayed").length,
        0,
      );
      return (
        `El torneo "${tournament.name}" está EN CURSO.\n\n` +
        `Se van a borrar ${rounds.length} ronda(s) y ${played} resultado(s) ya cargados.\n\n` +
        `Esta acción no se puede deshacer. ¿Eliminarlo igual?`
      );
    } catch {
      // Si no se pueden contar las rondas, igual se avisa que está en curso.
      return `El torneo "${tournament.name}" está EN CURSO y se perderán sus rondas.\n\n${base}`;
    }
  };

  const removeTournament = async () => {
    if (!confirm(await confirmMessage())) return;
    setDeleteError(null);
    try {
      await api.deleteTournament(tournament.id);
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
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
          <div>
            <button type="button" className="btn btn--danger btn--sm" onClick={removeTournament}>
              Eliminar torneo
            </button>
            {deleteError && <p className="form-error">{deleteError}</p>}
          </div>
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
