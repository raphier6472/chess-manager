import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { api, type RoundWithMatches } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { Match, Player } from "../types";
import type { TournamentContext } from "./TournamentShell";

const RESULT_OPTIONS: Array<{ value: "white" | "draw" | "black"; label: string }> = [
  { value: "white", label: "1-0" },
  { value: "draw", label: "½-½" },
  { value: "black", label: "0-1" },
];

export default function RoundPage() {
  const { isOrganizer } = useAuth();
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { tournament, reload: reloadTournament } = useOutletContext<TournamentContext>();
  const [rounds, setRounds] = useState<RoundWithMatches[] | null>(null);
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [viewedNumber, setViewedNumber] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!tournamentId) return;
    Promise.all([api.listRounds(tournamentId), api.listPlayers(tournamentId)]).then(
      ([r, p]) => {
        setRounds(r);
        setPlayers(p);
        setViewedNumber((current) => current ?? (r.length ? r[r.length - 1].number : null));
      },
      (e) => setError(e.message),
    );
  };

  useEffect(load, [tournamentId]);

  const nameOf = useMemo(() => {
    const m = new Map((players ?? []).map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? "?";
  }, [players]);

  if (!rounds || !players) return null;

  const latest = rounds[rounds.length - 1] ?? null;
  const viewed = rounds.find((r) => r.number === viewedNumber) ?? latest;
  const isLatest = !!viewed && !!latest && viewed.id === latest.id;
  const canGenerateNext =
    (!latest || latest.status === "completed") && rounds.length < tournament.numRounds;
  const tournamentDone = tournament.status === "completed";

  const generate = async () => {
    if (!tournamentId) return;
    setError(null);
    setBusy(true);
    try {
      const round = await api.generateRound(tournamentId);
      setViewedNumber(round.number);
      load();
      reloadTournament();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitResult = async (matchId: string, result: "white" | "draw" | "black") => {
    setError(null);
    try {
      await api.submitResult(matchId, result);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const completeRound = async () => {
    if (!viewed) return;
    setError(null);
    setBusy(true);
    try {
      await api.completeRound(viewed.id);
      load();
      reloadTournament();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
                background: r.number === viewedNumber ? "var(--brass-soft)" : "transparent",
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
                whiteName={nameOf(m.whiteId)}
                blackName={m.blackId ? nameOf(m.blackId) : null}
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
              {!allResultsIn && <p className="hint" style={{ marginTop: "0.5rem" }}>Cargá todos los resultados para poder cerrarla.</p>}
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
          <button type="button" className="btn btn--felt" disabled={busy} onClick={generate}>
            Emparejar ronda {rounds.length + 1}
          </button>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function BoardRow({
  index,
  match,
  whiteName,
  blackName,
  editable,
  onSubmit,
}: {
  index: number;
  match: Match;
  whiteName: string;
  blackName: string | null;
  editable: boolean;
  onSubmit: (matchId: string, result: "white" | "draw" | "black") => void;
}) {
  if (blackName === null) {
    return (
      <div className="card board-row board-row--bye">
        <span className="board-row__number">{index}</span>
        <span className="board-row__name">{whiteName}</span>
        <span className="board-row__bye-label">bye</span>
      </div>
    );
  }

  return (
    <div className="card board-row">
      <span className="board-row__number">{index}</span>
      <div className="board-row__player">
        <span className="piece-swatch piece-swatch--white" />
        <span className="board-row__name">{whiteName}</span>
      </div>
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
      <div className="board-row__player board-row__player--black">
        <span className="piece-swatch piece-swatch--black" />
        <span className="board-row__name">{blackName}</span>
      </div>
    </div>
  );
}
