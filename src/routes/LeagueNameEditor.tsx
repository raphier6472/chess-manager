import { useState } from "react";
import { api } from "../api/client";
import type { League } from "../types";

/**
 * Edición en línea del nombre de una liga, para corregir un error de tipeo. Los torneos
 * apuntan a la liga por id, así que renombrarla no toca ninguna relación.
 */
export default function LeagueNameEditor({
  league,
  onSaved,
  onCancel,
}: {
  league: League;
  onSaved: (league: League) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(league.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("el nombre de la liga es obligatorio");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.updateLeague(league.id, name.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form className="league-name-editor" onSubmit={save} noValidate>
      <div className="form-row">
        <div className="field" style={{ flex: "1 1 14rem" }}>
          <label htmlFor={`league-name-${league.id}`}>Nombre de la liga</label>
          <input
            id={`league-name-${league.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
            }}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="league-name-editor__actions">
          <button type="submit" className="btn btn--felt btn--sm" disabled={saving}>
            Guardar
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
