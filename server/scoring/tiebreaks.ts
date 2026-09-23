import type { StandingsRow } from "../../shared/types";

export interface MatchOutcome {
  /** null when this outcome is a bye (no opponent). */
  opponentId: string | null;
  /**
   * "bye" is the full-point bye; "half-bye" and "zero-bye" are rounds a late entrant
   * missed, worth ½ and 0 (see MatchResult in shared/types.ts).
   */
  result: "win" | "loss" | "draw" | "bye" | "half-bye" | "zero-bye";
}

export function outcomeScore(result: MatchOutcome["result"]): number {
  if (result === "win" || result === "bye") return 1;
  if (result === "draw" || result === "half-bye") return 0.5;
  return 0;
}

/**
 * Direct Encounter (FIDE head-to-head), computed separately for every group of players
 * on exactly the same score. Returns each tied player's points scored only against the
 * others in their group.
 *
 * Strict condition: the group must be a complete round-robin — every player in it met
 * every other one. If a single pairing is missing, the rule is skipped for the whole
 * group: none of them get a value, so they stay tied and the next tiebreak decides.
 * A two-way tie is the same rule with a group of two: the winner of their game gets 1
 * and the loser 0, a draw leaves both on ½ (still tied), no game leaves both null.
 *
 * It is applied once per score group, not again to whoever is still level after it.
 * Games decided by forfeit count as encounters with their recorded result: the pairing
 * happened and the point was awarded.
 */
export function directEncounterScores(
  players: Array<{ id: string }>,
  history: Map<string, MatchOutcome[]>,
  score: Map<string, number>,
): Map<string, number> {
  const groups = new Map<number, string[]>();
  for (const p of players) {
    const s = score.get(p.id) ?? 0;
    const group = groups.get(s);
    if (group) group.push(p.id);
    else groups.set(s, [p.id]);
  }

  const result = new Map<string, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const members = new Set(group);

    const met = (a: string, b: string) =>
      (history.get(a) ?? []).some((o) => o.opponentId === b);
    let roundRobin = true;
    for (let i = 0; i < group.length && roundRobin; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (!met(group[i], group[j])) {
          roundRobin = false;
          break;
        }
      }
    }
    if (!roundRobin) continue;

    for (const id of group) {
      const subScore = (history.get(id) ?? [])
        .filter((o) => o.opponentId !== null && members.has(o.opponentId))
        .reduce((sum, o) => sum + outcomeScore(o.result), 0);
      result.set(id, subScore);
    }
  }
  return result;
}

/**
 * Standings ordered by score, then Direct Encounter, then Buchholz (sum of opponents'
 * scores), then Sonneborn-Berger (sum of defeated opponents' scores, plus half of
 * drawn opponents' scores). Byes of any kind don't count as an opponent for any
 * tiebreak.
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

  const directEncounter = directEncounterScores(players, history, score);

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
      directEncounter: directEncounter.get(p.id) ?? null,
    };
  });

  // Direct Encounter only ever compares players of the same score, and within a score
  // group either everyone has a value or no one does, so treating null as 0 here just
  // means "no difference" for a group the rule skipped.
  rows.sort(
    (a, b) =>
      b.score - a.score ||
      (b.directEncounter ?? 0) - (a.directEncounter ?? 0) ||
      b.buchholz - a.buchholz ||
      b.sonnebornBerger - a.sonnebornBerger,
  );
  return rows;
}
