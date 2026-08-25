import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { StandingsRow } from "../types";

export default function Standings() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
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

  return (
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
  );
}
