import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { LeagueSummary } from "../types";

export default function CampeonatoList() {
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listLeagues()
      .then(setLeagues)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Suma de puntos entre torneos</p>
          <h1>Campeonatos</h1>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {leagues !== null && leagues.length === 0 && (
        <p className="empty-state">
          Todavía no hay ningún campeonato. Marcá la liga de un torneo desde la lista de torneos
          para empezar uno.
        </p>
      )}

      {leagues !== null && leagues.length > 0 && (
        <ul className="tournament-list">
          {leagues.map((l) => (
            <li key={l.id} className="card">
              <Link to={`/campeonato/${l.id}`} className="tournament-row">
                <div>
                  <div className="tournament-row__name">{l.name}</div>
                  <div className="tournament-row__meta">
                    {l.tournamentCount} {l.tournamentCount === 1 ? "torneo" : "torneos"}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
