import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatPlayerName, type Player } from "../types";

export default function Players() {
  const { isOrganizer } = useAuth();
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [rating, setRating] = useState("");
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

  const addPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournamentId || !lastName.trim()) return;
    setError(null);
    try {
      await api.addPlayer(tournamentId, {
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        rating: rating.trim() ? Number(rating) : null,
      });
      setLastName("");
      setFirstName("");
      setRating("");
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
            <div className="field" style={{ flex: "1 1 180px" }}>
              <label htmlFor="plastname">Apellido</label>
              <input
                id="plastname"
                ref={lastNameInput}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
            <div className="field" style={{ flex: "1 1 180px" }}>
              <label htmlFor="pfirstname">Nombre</label>
              <input id="pfirstname" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
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
