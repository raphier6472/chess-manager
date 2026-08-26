import { maxWeightMatching } from "./blossom";

export interface PairingPlayer {
  id: string;
  score: number;
  /** Positive = played white more often, negative = played black more often. */
  colorBalance: number;
  opponents: ReadonlySet<string>;
  hadBye: boolean;
}

export interface PairingPair {
  white: string;
  black: string;
}

export interface PairingResult {
  pairs: PairingPair[];
  bye: string | null;
}

// Weights are integers so the matching algorithm stays exact. Score-group
// closeness dominates the weight; rematches and repeat byes are pushed to
// the lowest possible positive weight so they're only used when there is no
// alternative that keeps everyone paired.
const BASE_WEIGHT = 10_000;
const SCORE_STEP = 10;
const REMATCH_WEIGHT = 1;
const MIN_NORMAL_WEIGHT = REMATCH_WEIGHT + 1;
const BYE_VERTEX_ID = "__bye__";

function scoreWeight(scoreDiff: number): number {
  return Math.max(MIN_NORMAL_WEIGHT, BASE_WEIGHT - scoreDiff * SCORE_STEP);
}

/**
 * Generate one round's Swiss pairings by solving maximum-weight matching
 * over a complete graph of eligible players (same technique Coronate uses
 * via `rescript-blossom`, see server/pairing/blossom.ts). Edge weight
 * favors same-score-group pairings; rematches and repeat byes are allowed
 * only as an absolute last resort.
 */
export function generatePairings(players: PairingPlayer[]): PairingResult {
  if (players.length === 0) return { pairs: [], bye: null };
  if (players.length === 1) {
    return { pairs: [], bye: players[0].id };
  }

  const withDummy = players.length % 2 === 1;
  const ids = players.map((p) => p.id);
  if (withDummy) ids.push(BYE_VERTEX_ID);

  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const byId = new Map(players.map((p) => [p.id, p]));

  const edges: Array<[number, number, number]> = [];
  for (let a = 0; a < players.length; a++) {
    for (let b = a + 1; b < players.length; b++) {
      const pa = players[a];
      const pb = players[b];
      const alreadyPlayed = pa.opponents.has(pb.id);
      const scoreDiff = Math.abs(Math.round(pa.score * 2) - Math.round(pb.score * 2));
      const weight = alreadyPlayed ? REMATCH_WEIGHT : scoreWeight(scoreDiff);
      edges.push([indexOf.get(pa.id)!, indexOf.get(pb.id)!, weight]);
    }
  }

  if (withDummy) {
    const byeIdx = indexOf.get(BYE_VERTEX_ID)!;
    for (const p of players) {
      const weight = p.hadBye ? REMATCH_WEIGHT : scoreWeight(Math.round(p.score * 2));
      edges.push([indexOf.get(p.id)!, byeIdx, weight]);
    }
  }

  const mateIdx = maxWeightMatching(ids.length, edges, true);

  const pairs: PairingPair[] = [];
  let bye: string | null = null;
  const seen = new Set<number>();
  for (let i = 0; i < ids.length; i++) {
    if (seen.has(i)) continue;
    const m = mateIdx[i];
    seen.add(i);
    if (m === -1) {
      // Defensive fallback: shouldn't happen on a complete even-order graph.
      if (ids[i] !== BYE_VERTEX_ID) bye = ids[i];
      continue;
    }
    seen.add(m);
    const idA = ids[i];
    const idB = ids[m];
    if (idA === BYE_VERTEX_ID) {
      bye = idB;
      continue;
    }
    if (idB === BYE_VERTEX_ID) {
      bye = idA;
      continue;
    }
    const pa = byId.get(idA)!;
    const pb = byId.get(idB)!;
    // Whoever is more "owed" white (lower colorBalance) plays white;
    // ties broken by the higher-scoring player getting white.
    let white = pa;
    let black = pb;
    if (
      pa.colorBalance > pb.colorBalance ||
      (pa.colorBalance === pb.colorBalance && pa.score < pb.score)
    ) {
      white = pb;
      black = pa;
    }
    pairs.push({ white: white.id, black: black.id });
  }

  // Board order follows standard Swiss practice: the leading score group
  // sits on board 1, descending from there, so winners keep climbing to the
  // top boards each round instead of staying wherever they were paired.
  pairs.sort((a, b) => {
    const scoreA = Math.max(byId.get(a.white)!.score, byId.get(a.black)!.score);
    const scoreB = Math.max(byId.get(b.white)!.score, byId.get(b.black)!.score);
    return scoreB - scoreA;
  });

  return { pairs, bye };
}
