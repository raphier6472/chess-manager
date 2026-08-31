import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ChampionshipStandingsRow, League } from "../types";

export default function Championship() {
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [rows, setRows] = useState<ChampionshipStandingsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listLeagues()
      .then((list) => {
        setLeagues(list);
        setLeagueId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!leagueId) return;
    api
      .getChampionshipStandings(leagueId)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [leagueId]);

  const selectedLeague = leagues?.find((l) => l.id === leagueId) ?? null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Suma de puntos entre torneos</p>
          <h1>Campeonato</h1>
        </div>
        {leagues && leagues.length > 0 && (
          <div className="field" style={{ width: "12rem" }}>
            <label htmlFor="league-select">Liga</label>
            <select id="league-select" value={leagueId ?? ""} onChange={(e) => setLeagueId(e.target.value)}>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      {leagues !== null && leagues.length === 0 && (
        <p className="empty-state">
          Todavía no hay ningún torneo marcado para una liga. Marcá la liga de un torneo desde la
          lista de torneos.
        </p>
      )}

      {leagueId && rows !== null && rows.length === 0 && (
        <p className="empty-state">
          Ningún torneo de la liga {selectedLeague?.name ?? ""} tiene resultados todavía.
        </p>
      )}

      {leagueId && rows !== null && rows.length > 0 && (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Jugador</th>
                <th className="num">Puntos</th>
                <th className="num">Torneos jugados</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.rosterPlayerId} className={i === 0 ? "rank-1" : ""}>
                  <td className="num">{i + 1}</td>
                  <td className="name">{r.name}</td>
                  <td className="num">{r.totalScore}</td>
                  <td className="num">{r.tournamentsPlayed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
