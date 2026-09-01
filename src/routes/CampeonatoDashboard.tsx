import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { ChampionshipBoard, Tournament } from "../types";

const STATUS_LABEL: Record<Tournament["status"], string> = {
  setup: "sin empezar",
  active: "en curso",
  completed: "terminado",
};

export default function CampeonatoDashboard() {
  const { isOrganizer } = useAuth();
  const { leagueId } = useParams<{ leagueId: string }>();
  const [board, setBoard] = useState<ChampionshipBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId) return;
    api
      .getChampionshipBoard(leagueId)
      .then(setBoard)
      .catch((e) => setError(e.message));
  }, [leagueId]);

  if (error) {
    return (
      <div className="stack">
        <p className="form-error">{error}</p>
        <Link to="/campeonato" className="btn btn--ghost btn--sm">
          ← Volver a campeonatos
        </Link>
      </div>
    );
  }

  if (!board) return null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link to="/campeonato">Campeonatos</Link> · suma de puntos entre torneos
          </p>
          <h1>{board.leagueName}</h1>
        </div>
        {isOrganizer && (
          <Link to={`/?leagueId=${board.leagueId}`} className="btn btn--primary">
            Nuevo torneo
          </Link>
        )}
      </div>

      <h2>Tabla acumulada</h2>

      {board.rows.length === 0 ? (
        <p className="empty-state">Todavía no hay resultados en esta liga.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Jugador</th>
                {board.tournaments.map((t) => (
                  <th key={t.id} className="num">
                    {t.name}
                    <br />
                    <span className="hint">{t.date}</span>
                  </th>
                ))}
                <th className="num">Total</th>
                <th className="num">Torneos jugados</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r, i) => (
                <tr key={r.rosterPlayerId} className={i === 0 ? "rank-1" : ""}>
                  <td className="num">{i + 1}</td>
                  <td className="name">{r.name}</td>
                  {board.tournaments.map((t) => (
                    <td key={t.id} className="num">
                      {r.scores[t.id] ?? "—"}
                    </td>
                  ))}
                  <td className="num">{r.totalScore}</td>
                  <td className="num">{r.tournamentsPlayed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Torneos de esta liga</h2>

      {board.tournaments.length === 0 ? (
        <p className="empty-state">Esta liga todavía no tiene torneos.</p>
      ) : (
        <ul className="tournament-list">
          {board.tournaments.map((t) => (
            <li key={t.id} className="card">
              <Link to={`/t/${t.id}`} className="tournament-row">
                <div>
                  <div className="tournament-row__name">{t.name}</div>
                  <div className="tournament-row__meta">
                    {t.date} · {t.numRounds} rondas
                  </div>
                </div>
                <span className={`badge ${t.status === "active" ? "badge--active" : t.status === "completed" ? "badge--completed" : ""}`}>
                  {STATUS_LABEL[t.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
