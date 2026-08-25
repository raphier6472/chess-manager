import type { StandingsRow } from "../../shared/types";

export interface MatchOutcome {
  /** null when this outcome is a bye (no opponent). */
  opponentId: string | null;
  result: "win" | "loss" | "draw" | "bye";
}

export function outcomeScore(result: MatchOutcome["result"]): number {
  if (result === "win" || result === "bye") return 1;
  if (result === "draw") return 0.5;
  return 0;
}

/**
 * Standings with Buchholz (sum of opponents' scores) and Sonneborn-Berger
 * (sum of defeated opponents' scores, plus half of drawn opponents' scores)
 * tiebreaks. Byes don't count as an opponent for either tiebreak.
 */
export function computeStandings(
  players: Array<{ id: string; name: string }>,
  history: Map<string, MatchOutcome[]>,
): StandingsRow[] {
  const score = new Map<string, number>();
  for (const p of players) {
    const outcomes = history.get(p.id) ?? [];
    score.set(
      p.id,
      outcomes.reduce((sum, o) => sum + outcomeScore(o.result), 0),
    );
  }

  const rows: StandingsRow[] = players.map((p) => {
    const outcomes = history.get(p.id) ?? [];
    let buchholz = 0;
    let sonnebornBerger = 0;
    for (const o of outcomes) {
      if (o.opponentId === null) continue;
      const oppScore = score.get(o.opponentId) ?? 0;
      buchholz += oppScore;
      if (o.result === "win") sonnebornBerger += oppScore;
      else if (o.result === "draw") sonnebornBerger += oppScore * 0.5;
    }
    return {
      playerId: p.id,
      name: p.name,
      score: score.get(p.id) ?? 0,
      buchholz,
      sonnebornBerger,
    };
  });

  rows.sort(
    (a, b) => b.score - a.score || b.buchholz - a.buchholz || b.sonnebornBerger - a.sonnebornBerger,
  );
  return rows;
}
