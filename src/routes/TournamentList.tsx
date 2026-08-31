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
 * Buscador "elegir o crear liga": tipear muestra ligas existentes que coincidan;
 * elegir una fija selectedId y reusa esa liga; seguir tipeando sin elegir deja el
 * nombre suelto para crear una liga nueva al guardar (mismo patrón que el buscador
 * del padrón de jugadores en Players.tsx, y por el mismo motivo: evitar que un
 * tilde o un espacio de más fragmente el campeonato en dos ligas).
 */
function LeaguePicker({
  idPrefix,
  value,
  onValueChange,
  selectedId,
  onSelect,
}: {
  idPrefix: string;
  value: string;
  onValueChange: (v: string) => void;
  selectedId: string | null;
  onSelect: (league: League | null) => void;
}) {
  const [matches, setMatches] = useState<League[]>([]);
  const showSuggestions = !selectedId && value.trim().length >= 2;

  useEffect(() => {
    if (!showSuggestions) return;
    const timer = setTimeout(() => {
      api.searchLeagues(value.trim()).then(setMatches, () => setMatches([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [value, showSuggestions]);

  const visibleMatches = showSuggestions ? matches : [];

  return (
    <div className="field" style={{ width: "12rem", position: "relative" }}>
      <label htmlFor={`${idPrefix}-league`}>Liga (opcional)</label>
      <input
        id={`${idPrefix}-league`}
        placeholder="Nombre de la liga"
        value={value}
        onChange={(e) => {
          onSelect(null);
          onValueChange(e.target.value);
        }}
        autoComplete="off"
      />
      {visibleMatches.length > 0 && (
        <ul className="roster-suggestions">
          {visibleMatches.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(l);
                  onValueChange(l.name);
                  setMatches([]);
                }}
              >
                {l.name} <span className="hint">— liga existente</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selectedId && (
        <p className="hint" style={{ marginTop: "0.2rem" }}>
          Se va a sumar a la liga existente.
        </p>
      )}
    </div>
  );
}

export default function TournamentList() {
  const { isOrganizer } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [papelera, setPapelera] = useState<Tournament[]>([]);
  const [showPapelera, setShowPapelera] = useState(false);
  const [editingLeagueRowId, setEditingLeagueRowId] = useState<string | null>(null);
  const [editingLeagueValue, setEditingLeagueValue] = useState("");
  const [editingSelectedLeagueId, setEditingSelectedLeagueId] = useState<string | null>(null);

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

  const startEditLeague = (t: Tournament) => {
    setError(null);
    setEditingLeagueRowId(t.id);
    setEditingLeagueValue(t.leagueName ?? "");
    // Arranca "seleccionada": si el organizador guarda sin tocar el campo, reusa la
    // misma liga en vez de crear una nueva con el mismo nombre.
    setEditingSelectedLeagueId(t.leagueId);
  };

  const saveLeague = async (t: Tournament) => {
    setError(null);
    try {
      await api.updateTournament(
        t.id,
        editingSelectedLeagueId
          ? { leagueId: editingSelectedLeagueId }
          : editingLeagueValue.trim()
            ? { leagueName: editingLeagueValue.trim() }
            : { leagueId: null },
      );
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
                      <LeaguePicker
                        idPrefix={`row-${t.id}`}
                        value={editingLeagueValue}
                        onValueChange={setEditingLeagueValue}
                        selectedId={editingSelectedLeagueId}
                        onSelect={(l) => setEditingSelectedLeagueId(l?.id ?? null)}
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

function NewTournamentForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [numRounds, setNumRounds] = useState(5);
  const [leagueName, setLeagueName] = useState("");
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
        ...(selectedLeagueId
          ? { leagueId: selectedLeagueId }
          : leagueName.trim()
            ? { leagueName: leagueName.trim() }
            : {}),
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
        <LeaguePicker
          idPrefix="new"
          value={leagueName}
          onValueChange={setLeagueName}
          selectedId={selectedLeagueId}
          onSelect={(l) => setSelectedLeagueId(l?.id ?? null)}
        />
        <button type="submit" className="btn btn--felt" disabled={saving}>
          {saving ? "Creando…" : "Crear"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
