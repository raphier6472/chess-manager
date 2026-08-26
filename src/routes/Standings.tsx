import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { StandingsRow } from "../types";
import type { TournamentContext } from "./TournamentShell";

export default function Standings() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { tournament } = useOutletContext<TournamentContext>();
  const [rows, setRows] = useState<StandingsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    api
      .getStandings(tournamentId)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [tournamentId]);

  if (error) return <p className="form-error">{error}</p>;
  if (!rows) return null;
  if (rows.length === 0) return <p className="empty-state">Todavía no hay jugadores anotados.</p>;

  const podium = tournament.status === "completed" ? rows.slice(0, 3) : [];

  return (
    <div className="stack">
      {podium.length > 0 && (
        <div>
          <p className="eyebrow">Resultado final</p>
          <ol className="podium">
            {podium.map((r, i) => (
              <li key={r.playerId} className={`podium__place podium__place--${i + 1}`}>
                <div className="podium__rank">{i + 1}º</div>
                <div className="podium__name">{r.name}</div>
                <div className="podium__score">{r.score} pts</div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <table className="data">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Jugador</th>
            <th className="num">Puntos</th>
            <th className="num">Buchholz</th>
            <th className="num">Sonneborn-Berger</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.playerId} className={i === 0 ? "rank-1" : ""}>
              <td className="num">{i + 1}</td>
              <td className="name">{r.name}</td>
              <td className="num">{r.score}</td>
              <td className="num">{r.buchholz}</td>
              <td className="num">{r.sonnebornBerger}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
