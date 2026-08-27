import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { Tournament } from "../types";

const STATUS_LABEL: Record<Tournament["status"], string> = {
  setup: "sin empezar",
  active: "en curso",
  completed: "terminado",
};

export default function TournamentList() {
  const { isOrganizer } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [papelera, setPapelera] = useState<Tournament[]>([]);
  const [showPapelera, setShowPapelera] = useState(false);

  const load = () => {
    api
      .listTournaments()
      .then(setTournaments)
      .catch((e) => setError(e.message));
    // La papelera solo la ve el organizador; el render ya está protegido por isOrganizer,
    // así que no hace falta limpiarla al cerrar sesión.
    if (isOrganizer) {
      api.listPapelera().then(setPapelera).catch(() => setPapelera([]));
    }
  };

  useEffect(load, [isOrganizer]);

  const restaurar = async (t: Tournament) => {
    setError(null);
    try {
      await api.restoreTournament(t.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const borrarDefinitivo = async (t: Tournament) => {
    if (!confirm(`¿Eliminar "${t.name}" para siempre?\n\nEsta acción no se puede deshacer.`)) return;
    setError(null);
    try {
      await api.deleteTournamentForever(t.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Sistema suizo</p>
          <h1>Torneos</h1>
        </div>
        {isOrganizer && (
          <button type="button" className="btn btn--primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancelar" : "Nuevo torneo"}
          </button>
        )}
      </div>

      {isOrganizer && showForm && (
        <NewTournamentForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {error && <p className="form-error">{error}</p>}

      {tournaments === null ? null : tournaments.length === 0 ? (
        <p className="empty-state">Todavía no has creado ningún torneo.</p>
      ) : (
        <ul className="tournament-list">
          {tournaments.map((t) => (
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

      {isOrganizer && papelera.length > 0 && (
        <div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-expanded={showPapelera}
            onClick={() => setShowPapelera((v) => !v)}
          >
            {showPapelera ? "Ocultar papelera" : `Papelera (${papelera.length})`}
          </button>

          {showPapelera && (
            <ul className="tournament-list" style={{ marginTop: "0.75rem" }}>
              {papelera.map((t) => (
                <li key={t.id} className="card">
                  <div className="tournament-row">
                    <div>
                      <div className="tournament-row__name">{t.name}</div>
                      <div className="tournament-row__meta">
                        {t.date} · {t.numRounds} rondas · en la papelera
                      </div>
                    </div>
                    <div className="form-row" style={{ gap: "0.4rem" }}>
                      <button type="button" className="btn btn--felt btn--sm" onClick={() => restaurar(t)}>
                        Restaurar
                      </button>
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => borrarDefinitivo(t)}>
                        Eliminar para siempre
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NewTournamentForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [numRounds, setNumRounds] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.createTournament({ name: name.trim(), date, numRounds });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card" style={{ padding: "1.1rem" }} onSubmit={submit}>
      <div className="form-row">
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label htmlFor="tname">Nombre</label>
          <input id="tname" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="tdate">Fecha</label>
          <input id="tdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="field" style={{ width: "6rem" }}>
          <label htmlFor="trounds">Rondas</label>
          <input
            id="trounds"
            type="number"
            min={1}
            max={30}
            value={numRounds}
            onChange={(e) => setNumRounds(Number(e.target.value))}
            required
          />
        </div>
        <button type="submit" className="btn btn--felt" disabled={saving}>
          {saving ? "Creando…" : "Crear"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
