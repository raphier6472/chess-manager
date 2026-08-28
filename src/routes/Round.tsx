import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { api, type RoundWithMatches } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatPlayerName, type Match, type Player, type StandingsRow } from "../types";
import type { TournamentContext } from "./TournamentShell";

const RESULT_OPTIONS: Array<{ value: "white" | "draw" | "black"; label: string }> = [
  { value: "white", label: "1-0" },
  { value: "draw", label: "½-½" },
  { value: "black", label: "0-1" },
];

/**
 * Línea bajo el nombre en la mesa. Sin Elo se omite el número: "0 · 3 pts" se leía
 * como dos puntajes distintos.
 */
function playerMeta(p: BoardPlayer): string {
  return p.rating != null ? `${p.rating} · ${p.score} pts` : `${p.score} pts`;
}

interface BoardPlayer {
  name: string;
  rating: number | null;
  score: number;
}

export default function RoundPage() {
  const { isOrganizer } = useAuth();
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { tournament, reload: reloadTournament } = useOutletContext<TournamentContext>();
  const [rounds, setRounds] = useState<RoundWithMatches[] | null>(null);
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [standings, setStandings] = useState<StandingsRow[] | null>(null);
  const [viewedNumber, setViewedNumber] = useState<number | null>(null);
  // Separados como en TournamentShell.tsx: loadError bloquea toda la vista (no hay nada
  // que mostrar sin datos), actionError se muestra sin ocultar la ronda que ya está en
  // pantalla. Antes eran un único estado y un error de "cargar resultado" tapaba todo
  // el tablero con solo un mensaje.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bye manual: jugadores que el organizador saca a propósito del próximo emparejamiento
  // (avisaron que no juegan esa ronda), en vez de depender del bye automático que solo
  // sale cuando el número de activos es impar.
  const [manualByeIds, setManualByeIds] = useState<string[]>([]);

  const load = () => {
    if (!tournamentId) return;
    Promise.all([api.listRounds(tournamentId), api.listPlayers(tournamentId), api.getStandings(tournamentId)]).then(
      ([r, p, s]) => {
        setRounds(r);
        setPlayers(p);
        setStandings(s);
        setViewedNumber((current) => current ?? (r.length ? r[r.length - 1].number : null));
      },
      (e) => setLoadError(e.message),
    );
  };

  useEffect(load, [tournamentId]);

  const infoOf = useMemo(() => {
    const scoreById = new Map((standings ?? []).map((s) => [s.playerId, s.score]));
    const m = new Map<string, BoardPlayer>(
      (players ?? []).map((p) => [
        p.id,
        { name: formatPlayerName(p), rating: p.rating, score: scoreById.get(p.id) ?? 0 },
      ]),
    );
    return (id: string): BoardPlayer => m.get(id) ?? { name: "?", rating: null, score: 0 };
  }, [players, standings]);

  // El error de carga va primero: si alguna de las tres peticiones falla (sesión vencida,
  // 500 de standings), rounds/players/standings quedan en null para siempre y el return de
  // abajo dejaba la pestaña en blanco sin mensaje ni forma de reintentar.
  if (loadError) return <p className="form-error">{loadError}</p>;
  if (!rounds || !players || !standings) return null;

  const latest = rounds[rounds.length - 1] ?? null;
  const viewed = rounds.find((r) => r.number === viewedNumber) ?? latest;
  const isLatest = !!viewed && !!latest && viewed.id === latest.id;
  const canGenerateNext =
    (!latest || latest.status === "completed") && rounds.length < tournament.numRounds;
  const tournamentDone = tournament.status === "completed";

  const generate = async () => {
    if (!tournamentId) return;
    setActionError(null);
    setBusy(true);
    try {
      const round = await api.generateRound(tournamentId, manualByeIds);
      setViewedNumber(round.number);
      setManualByeIds([]);
      load();
      reloadTournament();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleManualBye = (playerId: string) => {
    setManualByeIds((current) =>
      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId],
    );
  };

  const submitResult = async (matchId: string, result: "white" | "draw" | "black", forfeit = false) => {
    setActionError(null);
    try {
      await api.submitResult(matchId, result, forfeit);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const completeRound = async () => {
    if (!viewed) return;
    setActionError(null);
    setBusy(true);
    try {
      await api.completeRound(viewed.id);
      load();
      reloadTournament();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const reopenRound = async () => {
    if (!viewed) return;
    if (!confirm(`¿Reabrir la ronda ${viewed.number} para corregir un resultado?`)) return;
    setActionError(null);
    setBusy(true);
    try {
      await api.reopenRound(viewed.id);
      load();
      reloadTournament();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const allResultsIn = viewed?.matches.every((m) => m.blackId === null || m.result !== "unplayed");

  return (
    <div className="stack">
      {rounds.length > 1 && (
        <div className="form-row" style={{ gap: "0.35rem" }}>
          {rounds.map((r) => (
            <button
              key={r.id}
              type="button"
              className="btn btn--sm"
              style={{
                borderColor: "var(--line)",
                background: r.number === viewedNumber ? "var(--signal-soft)" : "transparent",
              }}
              onClick={() => setViewedNumber(r.number)}
            >
              Ronda {r.number}
            </button>
          ))}
        </div>
      )}

      {viewed && (
        <div>
          <div className="round-banner">
            <span className="round-banner__title">Ronda {viewed.number}</span>
            <span className="badge">{viewed.status === "completed" ? "cerrada" : "en juego"}</span>
          </div>

          <div className="board-list">
            {viewed.matches.map((m, i) => (
              <BoardRow
                key={m.id}
                index={i + 1}
                match={m}
                white={infoOf(m.whiteId)}
                black={m.blackId ? infoOf(m.blackId) : null}
                editable={isOrganizer && isLatest && viewed.status !== "completed"}
                onSubmit={submitResult}
              />
            ))}
          </div>

          {isOrganizer && isLatest && viewed.status !== "completed" && (
            <div style={{ marginTop: "1.25rem" }}>
              <button type="button" className="btn btn--primary" disabled={!allResultsIn || busy} onClick={completeRound}>
                Cerrar ronda {viewed.number}
              </button>
              {!allResultsIn && <p className="hint" style={{ marginTop: "0.5rem" }}>Carga todos los resultados para poder cerrarla.</p>}
            </div>
          )}

          {isOrganizer && isLatest && viewed.status === "completed" && (
            <div style={{ marginTop: "1.25rem" }}>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={reopenRound}>
                Reabrir ronda {viewed.number}
              </button>
              <p className="hint" style={{ marginTop: "0.5rem" }}>
                Si cargaste mal un resultado, reabre la ronda para corregirlo y vuelve a cerrarla.
              </p>
            </div>
          )}
        </div>
      )}

      {!viewed && !tournamentDone && (
        <p className="empty-state">Todavía no se generó ninguna ronda.</p>
      )}

      {tournamentDone && <p className="hint">El torneo ya terminó sus {tournament.numRounds} rondas.</p>}

      {isOrganizer && canGenerateNext && !tournamentDone && (
        <div>
          {players.some((p) => !p.withdrawn) && (
            <details className="bye-picker">
              <summary>Bye manual (opcional)</summary>
              <div className="stack" style={{ marginTop: "0.5rem" }}>
                {players
                  .filter((p) => !p.withdrawn)
                  .map((p) => (
                    <label key={p.id} className="bye-picker__option">
                      <input
                        type="checkbox"
                        checked={manualByeIds.includes(p.id)}
                        onChange={() => toggleManualBye(p.id)}
                      />
                      {formatPlayerName(p)}
                    </label>
                  ))}
              </div>
            </details>
          )}
          <button type="button" className="btn btn--felt" disabled={busy} onClick={generate}>
            Emparejar ronda {rounds.length + 1}
            {manualByeIds.length > 0 && ` (${manualByeIds.length} con bye manual)`}
          </button>
        </div>
      )}

      {actionError && <p className="form-error">{actionError}</p>}
    </div>
  );
}

function BoardRow({
  index,
  match,
  white,
  black,
  editable,
  onSubmit,
}: {
  index: number;
  match: Match;
  white: BoardPlayer;
  black: BoardPlayer | null;
  editable: boolean;
  onSubmit: (matchId: string, result: "white" | "draw" | "black", forfeit?: boolean) => void;
}) {
  if (black === null) {
    return (
      <div className="card board-row board-row--bye">
        <span className="board-row__number">{index}</span>
        <span className="board-row__name">{white.name}</span>
        <span className="board-row__bye-label">bye</span>
      </div>
    );
  }

  return (
    <div className="card board-row">
      <span className="board-row__number">{index}</span>
      <div className="board-row__player">
        <span className="piece-swatch piece-swatch--white" />
        <div className="board-row__player-text">
          <span className="board-row__name">{white.name}</span>
          <span className="board-row__player-meta">{playerMeta(white)}</span>
        </div>
      </div>
      <div className="result-cell">
        <div className="result-picker">
          {RESULT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={match.result === opt.value ? "selected" : ""}
              disabled={!editable}
              onClick={() => onSubmit(match.id, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {match.forfeit && <span className="badge board-row__wo-badge">W.O.</span>}
        {editable && (
          <div className="result-picker-wo">
            <button
              type="button"
              onClick={() => {
                if (confirm(`¿Blancas (${white.name}) no se presentaron? El punto es para negras.`)) {
                  onSubmit(match.id, "black", true);
                }
              }}
            >
              Ausente: blancas
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`¿Negras (${black.name}) no se presentaron? El punto es para blancas.`)) {
                  onSubmit(match.id, "white", true);
                }
              }}
            >
              Ausente: negras
            </button>
          </div>
        )}
      </div>
      <div className="board-row__player board-row__player--black">
        <span className="piece-swatch piece-swatch--black" />
        <div className="board-row__player-text">
          <span className="board-row__name">{black.name}</span>
          <span className="board-row__player-meta">{playerMeta(black)}</span>
        </div>
      </div>
    </div>
  );
}
