import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { League, Tournament } from "../types";

const STATUS_LABEL: Record<Tournament["status"], string> = {
  setup: "sin empezar",
  active: "en curso",
  completed: "terminado",
};

/**
 * Elegir una liga es siempre por id (el <select> solo puede tener valores que ya
 * existen) y crear una liga es una acción separada y explícita ("+ Nueva liga").
 * Antes había un único campo de texto "elegir o crear" -- tipear un nombre sin
 * elegir la sugerencia creaba una liga nueva en silencio, y en el uso real terminó
 * creando dos ligas "Khol 2026" distintas que partieron el campeonato en dos.
 */
function LeagueSelect({
  idPrefix,
  leagues,
  selectedId,
  onSelect,
  onCreated,
}: {
  idPrefix: string;
  leagues: League[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreated: (league: League) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const createLeague = async () => {
    if (!newName.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const league = await api.createLeague(newName.trim());
      onCreated(league);
      onSelect(league.id);
      setCreating(false);
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (creating) {
    return (
      <div className="field" style={{ width: "14rem" }}>
        <label htmlFor={`${idPrefix}-league-new`}>Nombre de la nueva liga</label>
        <div className="form-row" style={{ gap: "0.3rem" }}>
          <input
            id={`${idPrefix}-league-new`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <button type="button" className="btn btn--felt btn--sm" onClick={createLeague} disabled={saving}>
            Crear
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setCreating(false);
              setNewName("");
              setError(null);
            }}
          >
            Cancelar
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="field" style={{ width: "14rem" }}>
      <label htmlFor={`${idPrefix}-league`}>Liga (opcional)</label>
      <div className="form-row" style={{ gap: "0.3rem" }}>
        <select id={`${idPrefix}-league`} value={selectedId ?? ""} onChange={(e) => onSelect(e.target.value || null)}>
          <option value="">— sin liga —</option>
          {leagues.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreating(true)}>
          + Nueva liga
        </button>
      </div>
    </div>
  );
}

export default function TournamentList() {
  const { isOrganizer } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [papelera, setPapelera] = useState<Tournament[]>([]);
  const [showPapelera, setShowPapelera] = useState(false);
  const [editingLeagueRowId, setEditingLeagueRowId] = useState<string | null>(null);
  const [editingSelectedLeagueId, setEditingSelectedLeagueId] = useState<string | null>(null);

  const load = () => {
    api
      .listTournaments()
      .then(setTournaments)
      .catch((e) => setError(e.message));
    // La papelera y el listado completo de ligas (para el selector) solo los ve el
    // organizador; el render ya está protegido por isOrganizer, así que no hace
    // falta limpiarlos al cerrar sesión.
    if (isOrganizer) {
      api.listPapelera().then(setPapelera).catch(() => setPapelera([]));
      api.listAllLeagues().then(setLeagues).catch(() => setLeagues([]));
    }
  };

  useEffect(load, [isOrganizer]);

  // Una liga creada desde cualquiera de los dos selectores (alta o edición inline)
  // queda disponible al instante en ambos, sin esperar a un refetch.
  const addLeagueToList = (league: League) => {
    setLeagues((prev) => (prev.some((l) => l.id === league.id) ? prev : [...prev, league].sort((a, b) => a.name.localeCompare(b.name))));
  };

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

  const startEditLeague = (t: Tournament) => {
    setError(null);
    setEditingLeagueRowId(t.id);
    setEditingSelectedLeagueId(t.leagueId);
  };

  const saveLeague = async (t: Tournament) => {
    setError(null);
    try {
      await api.updateTournament(t.id, { leagueId: editingSelectedLeagueId });
      setEditingLeagueRowId(null);
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
          leagues={leagues}
          onLeagueCreated={addLeagueToList}
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
                    {t.leagueName && ` · liga ${t.leagueName}`}
                  </div>
                </div>
                <span className={`badge ${t.status === "active" ? "badge--active" : t.status === "completed" ? "badge--completed" : ""}`}>
                  {STATUS_LABEL[t.status]}
                </span>
              </Link>
              {isOrganizer && (
                <div className="form-row" style={{ padding: "0 0.9rem 0.75rem", gap: "0.4rem" }}>
                  {editingLeagueRowId === t.id ? (
                    <>
                      <LeagueSelect
                        idPrefix={`row-${t.id}`}
                        leagues={leagues}
                        selectedId={editingSelectedLeagueId}
                        onSelect={setEditingSelectedLeagueId}
                        onCreated={addLeagueToList}
                      />
                      <button type="button" className="btn btn--felt btn--sm" onClick={() => saveLeague(t)}>
                        Guardar
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setEditingLeagueRowId(null)}
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEditLeague(t)}>
                      {t.leagueName ? `Cambiar liga (${t.leagueName})` : "Marcar para una liga"}
                    </button>
                  )}
                </div>
              )}
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

function NewTournamentForm({
  leagues,
  onLeagueCreated,
  onCreated,
}: {
  leagues: League[];
  onLeagueCreated: (league: League) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [numRounds, setNumRounds] = useState(5);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const MIN_ROUNDS = 1;
  const MAX_ROUNDS = 30;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("el nombre es obligatorio");
      return;
    }
    if (!date) {
      setError("la fecha es obligatoria");
      return;
    }
    if (!Number.isInteger(numRounds) || numRounds < MIN_ROUNDS || numRounds > MAX_ROUNDS) {
      setError(`la cantidad de rondas debe ser un número entre ${MIN_ROUNDS} y ${MAX_ROUNDS}`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.createTournament({
        name: name.trim(),
        date,
        numRounds,
        ...(selectedLeagueId ? { leagueId: selectedLeagueId } : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card" style={{ padding: "1.1rem" }} onSubmit={submit} noValidate>
      <div className="form-row">
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label htmlFor="tname">Nombre</label>
          <input id="tname" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="tdate">Fecha</label>
          <input id="tdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
          />
        </div>
        <LeagueSelect
          idPrefix="new"
          leagues={leagues}
          selectedId={selectedLeagueId}
          onSelect={setSelectedLeagueId}
          onCreated={onLeagueCreated}
        />
        <button type="submit" className="btn btn--felt" disabled={saving}>
          {saving ? "Creando…" : "Crear"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
