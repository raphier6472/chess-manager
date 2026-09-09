import { maxWeightMatching } from "./blossom";
import { assignColors, colorsCompatible, type Color } from "./colors";

export type { Color };

export interface PairingPlayer {
  id: string;
  score: number;
  /** Colors already played, oldest first. Byes are not colors and are not listed. */
  colorHistory: readonly Color[];
  opponents: ReadonlySet<string>;
  hadBye: boolean;
  rating: number | null;
}

export interface PairingPair {
  white: string;
  black: string;
}

export interface PairingResult {
  pairs: PairingPair[];
  bye: string | null;
}

export interface SeedPlayer {
  id: string;
  lastName: string;
  firstName: string;
  rating: number | null;
}

export interface InitialPairingOptions {
  /**
   * Color for the top seed on board 1. Drawn at random when omitted, which is
   * the rule for round 1; pass it explicitly to make a round reproducible.
   */
  topBoardColor?: Color;
}

/**
 * Round-1 pairing: standard Swiss "fold" seeding (Harkness), the same
 * method Swiss Manager/Vega use. Players are ranked by rating (unrated
 * last), ties broken alphabetically by surname then given name (the
 * standard "Apellido, Nombre" tournament-list order), then the ranked list
 * is split in half and player i of the top half is paired against player i
 * of the bottom half (1 vs n/2+1, 2 vs n/2+2, ...). The top seed's color is
 * drawn at random and then alternates down the seeding: if board 1's
 * top-half player is white, board 2's is black, board 3's white again, and
 * so on. If the field is odd, the lowest-ranked player gets the bye.
 */
export function generateInitialPairings(
  players: SeedPlayer[],
  options: InitialPairingOptions = {},
): PairingResult {
  if (players.length === 0) return { pairs: [], bye: null };
  if (players.length === 1) return { pairs: [], bye: players[0].id };

  const seeded = [...players].sort((a, b) => {
    const ratingA = a.rating ?? -Infinity;
    const ratingB = b.rating ?? -Infinity;
    if (ratingA !== ratingB) return ratingB - ratingA;
    const lastNameCompare = a.lastName.localeCompare(b.lastName, "es");
    if (lastNameCompare !== 0) return lastNameCompare;
    return a.firstName.localeCompare(b.firstName, "es");
  });

  let bye: string | null = null;
  if (seeded.length % 2 === 1) {
    bye = seeded.pop()!.id;
  }

  const topBoardColor: Color = options.topBoardColor ?? (Math.random() < 0.5 ? "white" : "black");
  const topSeedIsWhiteOnBoard1 = topBoardColor === "white";

  const half = seeded.length / 2;
  const pairs: PairingPair[] = [];
  for (let i = 0; i < half; i++) {
    const top = seeded[i];
    const bottom = seeded[i + half];
    // Color alternates by board, not by seed, starting from the drawn color.
    const topIsWhite = (i % 2 === 0) === topSeedIsWhiteOnBoard1;
    if (topIsWhite) {
      pairs.push({ white: top.id, black: bottom.id });
    } else {
      pairs.push({ white: bottom.id, black: top.id });
    }
  }

  return { pairs, bye };
}

// Weights are integers so the matching algorithm stays exact. Inside a
// bracket every edge starts from FOLD_BASE and loses FOLD_STEP for each step
// away from the ideal fold partner. The magnitudes are separated far enough
// that the sum of every fold deviation in a bracket can never outweigh a
// single color violation, and the sum of every color violation can never
// outweigh a single repeat pairing — so the matching only ever buys a rule
// break when there is literally no alternative. FOLD_BASE is large enough
// that even a doubly-penalised edge keeps a positive weight.
const FOLD_BASE = 2_000_000_000;
const FOLD_STEP = 10;
const COLOR_VIOLATION_PENALTY = 10_000_000;
const REMATCH_PENALTY = 1_000_000_000;

/**
 * Constraints are dropped one at a time, hardest last, and only when the
 * whole field cannot be paired with them in place. Repeating a pairing is
 * treated as worse than bending the color rules, matching FIDE practice.
 */
interface Relaxation {
  rematch: boolean;
  colorViolation: boolean;
}

const RELAXATIONS: Relaxation[] = [
  { rematch: false, colorViolation: false },
  { rematch: false, colorViolation: true },
  { rematch: true, colorViolation: true },
];

/** How many combinations of down-floaters to try per bracket before giving up. */
const MAX_FLOAT_COMBINATIONS = 200;

/**
 * Floating more than two extra pairs out of a bracket is never the right
 * answer — the group would stop resembling a score group at all — and trying
 * it turns the backtracking into an exponential walk.
 */
const MAX_EXTRA_FLOAT_PAIRS = 2;

/**
 * Hard ceiling on bracket attempts per relaxation level. Without it a field
 * that is nearly impossible to pair can send the search exponential: a real
 * 31-player round was measured at ~5s before this cap. Running out of budget
 * just means this level gives up and the next, more permissive one takes
 * over, so a round is always produced — and the count (not a clock) keeps
 * the same field pairing the same way every time.
 */
const MAX_SEARCH_ATTEMPTS = 2_000;

interface SearchBudget {
  attempts: number;
}

function ratingKey(player: { rating: number | null }): number {
  return player.rating ?? -Infinity;
}

/** Score groups are exact, so compare on a half-point integer key. */
function scoreKey(player: PairingPlayer): number {
  return Math.round(player.score * 2);
}

/** Standings order: score desc, then rating desc (unrated last), then id. */
function byStandings(a: PairingPlayer, b: PairingPlayer): number {
  if (a.score !== b.score) return b.score - a.score;
  const ratingA = ratingKey(a);
  const ratingB = ratingKey(b);
  if (ratingA !== ratingB) return ratingB - ratingA;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Bye order: lowest score group first, lowest rating inside it, then id. */
function byByePreference(a: PairingPlayer, b: PairingPlayer): number {
  if (a.score !== b.score) return a.score - b.score;
  const ratingA = ratingKey(a);
  const ratingB = ratingKey(b);
  if (ratingA !== ratingB) return ratingA - ratingB;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Who should get the bye, best candidate first, split by whether they have
 * already had one. A second bye hands out a free point to someone who has
 * already been handed one, which skews the standings more than any other
 * concession, so the repeat list is only consulted after every other rule has
 * already been tried and relaxed.
 */
function byeCandidates(players: PairingPlayer[]): {
  eligible: PairingPlayer[];
  repeat: PairingPlayer[];
} {
  return {
    eligible: players.filter((p) => !p.hadBye).sort(byByePreference),
    repeat: players.filter((p) => p.hadBye).sort(byByePreference),
  };
}

/**
 * Subsets of `bracket` (as indices) that could float down, best first. Rule:
 * the lowest-rated players float, so subsets taken from the bottom of the
 * bracket come first; the rest are only reached when the preferred float
 * leaves the bracket unpairable.
 */
function floatChoices(bracketSize: number, count: number): number[][] {
  if (count <= 0) return [[]];
  if (count >= bracketSize) return [Array.from({ length: bracketSize }, (_, i) => i)];
  const combos: number[][] = [];
  const acc: number[] = [];
  const pick = (maxIndex: number) => {
    if (combos.length >= MAX_FLOAT_COMBINATIONS) return;
    if (acc.length === count) {
      combos.push([...acc].reverse());
      return;
    }
    const need = count - acc.length;
    for (let i = maxIndex; i >= need - 1; i--) {
      acc.push(i);
      pick(i - 1);
      acc.pop();
      if (combos.length >= MAX_FLOAT_COMBINATIONS) return;
    }
  };
  pick(bracketSize - 1);
  return combos;
}

/**
 * The position each seat in a bracket would meet if nothing got in the way.
 * `bracket` holds any players who floated down from a higher score group
 * first, then the residents in rating order, so the ideal shape is:
 *
 *   - floater k meets resident k, the highest-rated resident still free
 *     (rule 5: a floater drops onto the top of the next group);
 *   - the residents left over fold top half against bottom half, so the
 *     first of them meets the one exactly half a fold below.
 */
function idealPartners(size: number, floaterCount: number): number[] {
  const floaters = Math.min(floaterCount, Math.floor(size / 2));
  const foldStart = floaters * 2;
  const half = (size - foldStart) / 2;
  const ideal: number[] = [];
  for (let i = 0; i < size; i++) {
    if (i < floaters) ideal.push(floaters + i);
    else if (i < foldStart) ideal.push(i - floaters);
    else if (i < foldStart + half) ideal.push(i + half);
    else ideal.push(i - half);
  }
  return ideal;
}

/**
 * Pair one bracket completely. Every edge is scored by how far both of its
 * ends are from their ideal partner, so the maximum-weight matching returns
 * the arrangement closest to the textbook fold that is still legal — and
 * returns null when the bracket has no legal perfect matching at all, which
 * is the caller's cue to backtrack.
 */
function matchBracket(
  bracket: PairingPlayer[],
  floaterCount: number,
  relax: Relaxation,
): PairingPair[] | null {
  const size = bracket.length;
  if (size === 0) return [];
  if (size % 2 === 1) return null;

  const ideal = idealPartners(size, floaterCount);
  const edges: Array<[number, number, number]> = [];
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const a = bracket[i];
      const b = bracket[j];
      const rematch = a.opponents.has(b.id);
      if (rematch && !relax.rematch) continue;
      const colorOk = colorsCompatible(a, b);
      if (!colorOk && !relax.colorViolation) continue;
      const deviation = Math.abs(j - ideal[i]) + Math.abs(i - ideal[j]);
      let weight = FOLD_BASE - deviation * FOLD_STEP;
      if (rematch) weight -= REMATCH_PENALTY;
      if (!colorOk) weight -= COLOR_VIOLATION_PENALTY;
      edges.push([i, j, Math.max(1, weight)]);
    }
  }
  if (edges.length === 0) return null;

  const mate = maxWeightMatching(size, edges, true);
  const pairs: PairingPair[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < size; i++) {
    if (seen.has(i)) continue;
    const partner = mate[i];
    // Anything short of a perfect matching means this bracket shape is a dead
    // end; the caller backtracks to a different float choice.
    if (partner === undefined || partner < 0) return null;
    seen.add(i);
    seen.add(partner);
    pairs.push(assignColors(bracket[i], bracket[partner]));
  }
  return pairs;
}

/**
 * Walk the score groups from the top, carrying down-floaters into the next
 * one, and backtrack whenever a bracket turns out to be unpairable — either
 * because the only opponents left have already met, or because their colors
 * cannot be reconciled. Floating extra pairs of players down is the last
 * resort inside a level, before the caller relaxes a constraint.
 */
function searchBrackets(
  groups: PairingPlayer[][],
  index: number,
  floaters: PairingPlayer[],
  relax: Relaxation,
  budget: SearchBudget,
): PairingPair[] | null {
  if (index >= groups.length) return floaters.length === 0 ? [] : null;

  const bracket = [...floaters, ...groups[index]].sort(byStandings);
  const isLast = index === groups.length - 1;
  // The last bracket has nowhere to float to: everyone left must be paired.
  const parity = bracket.length % 2;
  const maxDown = isLast ? 0 : Math.min(bracket.length, parity + MAX_EXTRA_FLOAT_PAIRS * 2);
  const residentScore = scoreKey(groups[index][0]);

  for (let down = parity; down <= maxDown; down += 2) {
    for (const downIndices of floatChoices(bracket.length, down)) {
      if (budget.attempts >= MAX_SEARCH_ATTEMPTS) return null;
      budget.attempts++;
      const downSet = new Set(downIndices);
      const stay = bracket.filter((_, i) => !downSet.has(i));
      const stayingFloaters = stay.filter((p) => scoreKey(p) !== residentScore).length;
      const paired = matchBracket(stay, stayingFloaters, relax);
      if (!paired) continue;
      const tail = searchBrackets(
        groups,
        index + 1,
        downIndices.map((i) => bracket[i]),
        relax,
        budget,
      );
      if (tail) return [...paired, ...tail];
    }
  }
  return null;
}

function pairField(
  field: PairingPlayer[],
  relax: Relaxation,
  budget: SearchBudget,
): PairingPair[] | null {
  if (field.length === 0) return [];
  const sorted = [...field].sort(byStandings);
  const groups: PairingPlayer[][] = [];
  for (const player of sorted) {
    const last = groups[groups.length - 1];
    if (last && scoreKey(last[0]) === scoreKey(player)) last.push(player);
    else groups.push([player]);
  }
  return searchBrackets(groups, 0, [], relax, budget);
}

// Weights for the whole-field fallback below. Score-group distance dominates
// the fold, a single color violation outweighs every score-group penalty
// combined, and a single repeat pairing outweighs every color violation.
const GLOBAL_SCORE_STEP = 10_000;

/**
 * Whole-field fallback: one maximum-weight matching over every player at
 * once, with exactly the same edges the bracket walk was allowed to use.
 *
 * The bracket walk is what produces the textbook shape — exact score groups,
 * folds, the lowest player floating down — but it explores a limited number
 * of arrangements before giving up. This pass gives up nothing: if any legal
 * pairing of the field exists it finds one, so "two players never meet twice"
 * holds whenever it is mathematically possible, not just whenever the bracket
 * walk happened to spot it. It only runs when the bracket walk comes back
 * empty, so the tidy structure still wins in every ordinary round.
 */
function matchWholeField(field: PairingPlayer[], relax: Relaxation): PairingPair[] | null {
  const size = field.length;
  if (size === 0) return [];
  if (size % 2 === 1) return null;

  const sorted = [...field].sort(byStandings);
  const groupHalf = new Map<number, number>();
  for (const player of sorted) {
    const key = scoreKey(player);
    groupHalf.set(key, (groupHalf.get(key) ?? 0) + 1);
  }
  for (const [key, count] of groupHalf) groupHalf.set(key, Math.floor(count / 2));

  const edges: Array<[number, number, number]> = [];
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const rematch = a.opponents.has(b.id);
      if (rematch && !relax.rematch) continue;
      const colorOk = colorsCompatible(a, b);
      if (!colorOk && !relax.colorViolation) continue;
      const scoreGap = Math.abs(scoreKey(a) - scoreKey(b));
      const sameGroup = scoreGap === 0;
      const idealSpan = sameGroup ? (groupHalf.get(scoreKey(a)) ?? 1) : 1;
      let weight =
        FOLD_BASE - scoreGap * GLOBAL_SCORE_STEP - Math.abs(j - i - idealSpan) * FOLD_STEP;
      if (rematch) weight -= REMATCH_PENALTY;
      if (!colorOk) weight -= COLOR_VIOLATION_PENALTY;
      edges.push([i, j, Math.max(1, weight)]);
    }
  }
  if (edges.length === 0) return null;

  const mate = maxWeightMatching(size, edges, true);
  const pairs: PairingPair[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < size; i++) {
    if (seen.has(i)) continue;
    const partner = mate[i];
    if (partner === undefined || partner < 0) return null;
    seen.add(i);
    seen.add(partner);
    pairs.push(assignColors(sorted[i], sorted[partner]));
  }
  return pairs;
}

/**
 * Board order follows standard Swiss practice: the leading score group sits
 * on board 1, descending from there, so the highest-rated player of the
 * highest score group always plays board 1 and winners keep climbing to the
 * top boards each round.
 */
function orderBoards(pairs: PairingPair[], field: PairingPlayer[]): PairingPair[] {
  const rank = new Map<string, number>();
  [...field].sort(byStandings).forEach((player, i) => rank.set(player.id, i));
  const bestRank = (pair: PairingPair) =>
    Math.min(rank.get(pair.white) ?? Infinity, rank.get(pair.black) ?? Infinity);
  return [...pairs].sort((a, b) => bestRank(a) - bestRank(b));
}

/**
 * Generate one round's Swiss pairings.
 *
 * Score groups are exact and are processed from the top down; inside a group
 * players are sorted by rating and folded top half against bottom half; an
 * odd group sends its lowest-rated player down to meet the highest-rated
 * player of the next group. Two players never meet twice and never break the
 * color constraints unless the field cannot be paired at all otherwise, in
 * which case those constraints are relaxed one at a time (see RELAXATIONS).
 * With an odd field the bye goes to the lowest-rated player of the lowest
 * score group who has not had one yet.
 */
export function generatePairings(players: PairingPlayer[]): PairingResult {
  if (players.length === 0) return { pairs: [], bye: null };
  if (players.length === 1) return { pairs: [], bye: players[0].id };

  const needsBye = players.length % 2 === 1;
  const byes = byeCandidates(players);
  // Every rule is tried and relaxed against the players who may still take a
  // bye before a second bye is even considered.
  const stages: Array<Array<PairingPlayer | null>> = needsBye
    ? [byes.eligible, byes.repeat]
    : [[null]];

  for (const stage of stages) {
    if (stage.length === 0) continue;
    for (const relax of RELAXATIONS) {
      // One budget per level, shared by every bye candidate: a level that
      // cannot pair this field is abandoned quickly instead of re-running the
      // same hopeless search once per candidate.
      const budget: SearchBudget = { attempts: 0 };
      for (const byePlayer of stage) {
        const field = byePlayer ? players.filter((p) => p.id !== byePlayer.id) : players;
        const pairs = pairField(field, relax, budget);
        if (pairs) return { pairs: orderBoards(pairs, field), bye: byePlayer?.id ?? null };
      }
      // The bracket walk found no arrangement at this level. Before giving up
      // any constraint, ask the whole-field matching whether one exists at all.
      for (const byePlayer of stage) {
        const field = byePlayer ? players.filter((p) => p.id !== byePlayer.id) : players;
        const pairs = matchWholeField(field, relax);
        if (pairs) return { pairs: orderBoards(pairs, field), bye: byePlayer?.id ?? null };
      }
    }
  }

  // Unreachable: at the last relaxation every bracket is a complete graph, so
  // a perfect matching always exists. Kept so a pairing bug can never take a
  // live round down — pair straight down the standings instead.
  const byePlayer = needsBye ? (byes.eligible[0] ?? byes.repeat[0]) : null;
  const field = byePlayer ? players.filter((p) => p.id !== byePlayer.id) : players;
  const sorted = [...field].sort(byStandings);
  const pairs: PairingPair[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 2) {
    pairs.push(assignColors(sorted[i], sorted[i + 1]));
  }
  return { pairs, bye: byePlayer?.id ?? null };
}
