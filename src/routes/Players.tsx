import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { Player } from "../types";
import type { TournamentContext } from "./TournamentShell";

export default function Players() {
  const { isOrganizer } = useAuth();
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { tournament } = useOutletContext<TournamentContext>();
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rating, setRating] = useState("");

  const load = () => {
    if (!tournamentId) return;
    api
      .listPlayers(tournamentId)
      .then(setPlayers)
      .catch((e) => setError(e.message));
  };

  useEffect(load, [tournamentId]);

  const addPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournamentId || !name.trim()) return;
    setError(null);
    try {
      await api.addPlayer(tournamentId, {
        name: name.trim(),
        rating: rating.trim() ? Number(rating) : null,
      });
      setName("");
      setRating("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleWithdrawn = async (p: Player) => {
    await api.updatePlayer(p.id, { withdrawn: !p.withdrawn });
    load();
  };

  const remove = async (p: Player) => {
    if (!confirm(`¿Quitar a ${p.name} del torneo?`)) return;
    try {
      await api.deletePlayer(p.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const canDelete = tournament.status === "setup";

  return (
    <div className="stack">
      {isOrganizer && (
        <form className="card" style={{ padding: "1.1rem" }} onSubmit={addPlayer}>
          <div className="form-row">
            <div className="field" style={{ flex: "2 1 220px" }}>
              <label htmlFor="pname">Nombre</label>
              <input id="pname" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field" style={{ width: "7rem" }}>
              <label htmlFor="prating">Elo (opcional)</label>
              <input id="prating" type="number" value={rating} onChange={(e) => setRating(e.target.value)} />
            </div>
            <button type="submit" className="btn btn--felt">
              Agregar
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </form>
      )}

      {players === null ? null : players.length === 0 ? (
        <p className="empty-state">Todavía no hay jugadores anotados.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Nombre</th>
              <th className="num">Elo</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} style={p.withdrawn ? { opacity: 0.5 } : undefined}>
                <td>{p.name}</td>
                <td className="num">{p.rating ?? "—"}</td>
                <td>
                  {isOrganizer && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggleWithdrawn(p)}>
                      {p.withdrawn ? "Reincorporar" : "Retirar"}
                    </button>
                  )}
                </td>
                <td>
                  {isOrganizer && canDelete && (
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(p)}>
                      Quitar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
