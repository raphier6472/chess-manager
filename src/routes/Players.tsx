import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatPlayerName, type Player, type RosterPlayer } from "../types";

export default function Players() {
  const { isOrganizer } = useAuth();
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [rating, setRating] = useState("");
  // Buscador del padrón compartido: elegir una sugerencia fija selectedRosterId y
  // reusa esa identidad entre torneos; seguir tipeando sin elegir da de alta una
  // persona nueva (a propósito, ver POST /tournaments/:id/players en el servidor).
  const [rosterMatches, setRosterMatches] = useState<RosterPlayer[]>([]);
  const [selectedRosterId, setSelectedRosterId] = useState<string | null>(null);
  // Anotar la lista al inicio del torneo es repetitivo: el foco vuelve acá tras cada
  // alta para poder encadenar jugadores sin sacar la mano del teclado.
  const lastNameInput = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLastName, setEditLastName] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editRating, setEditRating] = useState("");

  const load = () => {
    if (!tournamentId) return;
    api
      .listPlayers(tournamentId)
      .then(setPlayers)
      .catch((e) => setError(e.message));
  };

  useEffect(load, [tournamentId]);

  const showSuggestions = !selectedRosterId && lastName.trim().length >= 2;

  useEffect(() => {
    if (!showSuggestions) return;
    const timer = setTimeout(() => {
      api.searchRoster(lastName.trim()).then(setRosterMatches, () => setRosterMatches([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [lastName, showSuggestions]);

  const visibleRosterMatches = showSuggestions ? rosterMatches : [];

  const pickRosterMatch = (m: RosterPlayer) => {
    setSelectedRosterId(m.id);
    setLastName(m.lastName);
    setFirstName(m.firstName);
    setRosterMatches([]);
  };

  const addPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournamentId || !lastName.trim()) return;
    setError(null);
    try {
      await api.addPlayer(
        tournamentId,
        selectedRosterId
          ? { rosterPlayerId: selectedRosterId, rating: rating.trim() ? Number(rating) : null }
          : {
              lastName: lastName.trim(),
              firstName: firstName.trim(),
              rating: rating.trim() ? Number(rating) : null,
            },
      );
      setLastName("");
      setFirstName("");
      setRating("");
      setSelectedRosterId(null);
      setRosterMatches([]);
      lastNameInput.current?.focus();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleWithdrawn = async (p: Player) => {
    setError(null);
    try {
      await api.updatePlayer(p.id, { withdrawn: !p.withdrawn });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startEdit = (p: Player) => {
    setError(null);
    setEditingId(p.id);
    setEditLastName(p.lastName);
    setEditFirstName(p.firstName);
    setEditRating(p.rating != null ? String(p.rating) : "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (p: Player) => {
    if (!editLastName.trim()) return;
    setError(null);
    try {
      await api.updatePlayer(p.id, {
        lastName: editLastName.trim(),
        firstName: editFirstName.trim(),
        rating: editRating.trim() ? Number(editRating) : null,
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (p: Player) => {
    if (!confirm(`¿Quitar a ${formatPlayerName(p)} del torneo?`)) return;
    try {
      await api.deletePlayer(p.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="stack">
      {isOrganizer && (
        <form className="card" style={{ padding: "1.1rem" }} onSubmit={addPlayer}>
          <div className="form-row">
            <div className="field" style={{ flex: "1 1 180px", position: "relative" }}>
              <label htmlFor="plastname">Apellido</label>
              <input
                id="plastname"
                ref={lastNameInput}
                value={lastName}
                onChange={(e) => {
                  setSelectedRosterId(null);
                  setLastName(e.target.value);
                }}
                autoComplete="off"
                required
              />
              {visibleRosterMatches.length > 0 && (
                <ul className="roster-suggestions">
                  {visibleRosterMatches.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => pickRosterMatch(m)}>
                        {formatPlayerName(m)} <span className="hint">— ya está en el padrón</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="field" style={{ flex: "1 1 180px" }}>
              <label htmlFor="pfirstname">Nombre</label>
              <input
                id="pfirstname"
                value={firstName}
                onChange={(e) => {
                  setSelectedRosterId(null);
                  setFirstName(e.target.value);
                }}
              />
            </div>
            <div className="field" style={{ width: "7rem" }}>
              <label htmlFor="prating">Elo (opcional)</label>
              <input id="prating" type="number" value={rating} onChange={(e) => setRating(e.target.value)} />
            </div>
            <button type="submit" className="btn btn--felt">
              Agregar
            </button>
          </div>
          {selectedRosterId && (
            <p className="hint" style={{ marginTop: "0.35rem" }}>
              Se va a usar la identidad del padrón de {formatPlayerName({ lastName, firstName })}.
            </p>
          )}
          {error && <p className="form-error">{error}</p>}
        </form>
      )}

      {players === null ? null : players.length === 0 ? (
        <p className="empty-state">Todavía no hay jugadores anotados.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Apellido</th>
                <th>Nombre</th>
                <th className="num">Elo</th>
                <th></th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const isEditing = editingId === p.id;
                return (
                  <tr key={p.id} style={p.withdrawn && !isEditing ? { opacity: 0.5 } : undefined}>
                    <td>
                      {isEditing ? (
                        <input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} autoFocus />
                      ) : (
                        p.lastName
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} />
                      ) : (
                        p.firstName
                      )}
                    </td>
                    <td className="num">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editRating}
                          onChange={(e) => setEditRating(e.target.value)}
                          style={{ width: "5rem" }}
                        />
                      ) : (
                        p.rating ?? 0
                      )}
                    </td>
                    <td>
                      {isOrganizer &&
                        (isEditing ? (
                          <button type="button" className="btn btn--felt btn--sm" onClick={() => saveEdit(p)}>
                            Guardar
                          </button>
                        ) : (
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEdit(p)}>
                            Editar
                          </button>
                        ))}
                    </td>
                    <td>
                      {isOrganizer &&
                        (isEditing ? (
                          <button type="button" className="btn btn--ghost btn--sm" onClick={cancelEdit}>
                            Cancelar
                          </button>
                        ) : (
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggleWithdrawn(p)}>
                            {p.withdrawn ? "Reincorporar" : "Retirar"}
                          </button>
                        ))}
                    </td>
                    <td>
                      {isOrganizer && !isEditing && (
                        <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(p)}>
                          Quitar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
