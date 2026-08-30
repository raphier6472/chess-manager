import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ChampionshipStandingsRow } from "../types";

export default function Championship() {
  const [seasons, setSeasons] = useState<string[] | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const [rows, setRows] = useState<ChampionshipStandingsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listChampionshipSeasons()
      .then((list) => {
        setSeasons(list);
        setSeason((current) => current ?? list[0] ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!season) return;
    api
      .getChampionshipStandings(season)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [season]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Suma de puntos entre torneos</p>
          <h1>Campeonato</h1>
        </div>
        {seasons && seasons.length > 0 && (
          <div className="field" style={{ width: "8rem" }}>
            <label htmlFor="season-select">Temporada</label>
            <select id="season-select" value={season ?? ""} onChange={(e) => setSeason(e.target.value)}>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      {seasons !== null && seasons.length === 0 && (
        <p className="empty-state">
          Todavía no hay ningún torneo marcado para un campeonato. Marcá la temporada de un torneo
          desde la lista de torneos.
        </p>
      )}

      {season && rows !== null && rows.length === 0 && (
        <p className="empty-state">Ningún torneo de la temporada {season} tiene resultados todavía.</p>
      )}

      {season && rows !== null && rows.length > 0 && (
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
