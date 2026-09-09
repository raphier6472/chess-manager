import { maxWeightMatching } from "./blossom";
import { assignColors, colorsCompatible, deniedPreference, type Color } from "./colors";

export type { Color };

export interface PairingPlayer {
  id: string;
  /**
   * Surname and given name. FIDE C.04.1.i wants a pairing an arbiter can
   * explain, so two players on the same rating are separated the same way the
   * round-1 seeding separates them — alphabetically — rather than by whatever
   * internal id they happen to carry.
   */
  lastName: string;
  firstName: string;
  score: number;
  /** Colors already played, oldest first. Byes are not colors and are not listed. */
  colorHistory: readonly Color[];
  opponents: ReadonlySet<string>;
  hadBye: boolean;
  /**
   * Whether this player has already scored a win because an opponent did not
   * turn up. FIDE C.04.1.d bars them from the pairing-allocated bye just as a
   * previous bye does: both already handed them a point without a game.
   */
  hadForfeitWin: boolean;
  /**
   * Whether this player was moved down to a lower score group in the previous
   * round. FIDE asks that the same player not be made to float down twice
   * running when there is any alternative.
   */
  downfloatedLastRound: boolean;
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
// away from the ideal fold partner, plus a penalty for each rule it bends.
//
// The tiers are spaced so that the worst possible total at one tier still
// cannot outweigh a single penalty from the tier above, for fields up to
// roughly 60 players: every fold deviation combined loses to one denied mild
// preference, every denied mild preference loses to one denied strong
// preference, and so on up to a repeat pairing. So the matching only ever
// bends a rule when there is no alternative, and always bends the cheapest
// one. FOLD_BASE stays above the sum of every penalty, so weights stay
// positive, and the largest total stays far inside exact integer range.
const FOLD_BASE = 2_000_000_000_000;
const FOLD_STEP = 10;
const MILD_PREFERENCE_PENALTY = 1_000_000;
const STRONG_PREFERENCE_PENALTY = 100_000_000;
const COLOR_VIOLATION_PENALTY = 10_000_000_000;
const REMATCH_PENALTY = 1_000_000_000_000;

/**
 * Cost of the color preference this pairing would have to deny. An "absolute"
 * denial is exactly what an incompatible pair is, and that is already charged
 * COLOR_VIOLATION_PENALTY, so it is not counted twice here.
 */
function preferencePenalty(a: PairingPlayer, b: PairingPlayer): number {
  switch (deniedPreference(a, b)) {
    case "strong":
      return STRONG_PREFERENCE_PENALTY;
    case "mild":
      return MILD_PREFERENCE_PENALTY;
    default:
      return 0;
  }
}

/**
 * Constraints are dropped one at a time, hardest last, and only when the
 * whole field cannot be paired with them in place.
 *
 * `maxBracketSpan` is how many score groups apart two opponents may be: 1
 * means a player who floats down lands in the very next group that exists,
 * never past it. It is widened before any color rule is bent, because FIDE
 * ranks keeping players near their own score above color preferences — and a
 * player two brackets adrift is far more visible at the board than a colour
 * they did not want. Repeating a pairing stays the very last thing to give.
 */
interface Relaxation {
  maxBracketSpan: number;
  rematch: boolean;
  colorViolation: boolean;
}

/**
 * The ladder is built for the field at hand rather than fixed, so the span
 * opens one score group at a time and the round is always paired at the
 * smallest span that admits a solution.
 *
 * Every span is exhausted with the color rules intact before any of them is
 * bent. In the Dutch system the color limits of C.04.1.f/g are *absolute*
 * criteria while keeping players near their own score is a quality one, so
 * dragging a player an extra bracket down is the correct price for keeping a
 * color legal — not the other way round. Repeating a pairing stays last.
 */
function relaxationLadder(groupCount: number): Relaxation[] {
  const widest = Math.max(1, groupCount - 1);
  const ladder: Relaxation[] = [];
  for (let span = 1; span <= widest; span++) {
    ladder.push({ maxBracketSpan: span, rematch: false, colorViolation: false });
  }
  for (let span = 1; span <= widest; span++) {
    ladder.push({ maxBracketSpan: span, rematch: false, colorViolation: true });
  }
  // Last resort: repeat a pairing rather than fail to produce a round.
  ladder.push({ maxBracketSpan: Infinity, rematch: true, colorViolation: true });
  return ladder;
}

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

/**
 * Separates two players of equal rating, in the same order the round-1
 * seeding uses: surname, then given name, and only then the internal id as a
 * last resort so the result is always deterministic.
 */
function compareByName(a: PairingPlayer, b: PairingPlayer): number {
  const lastNames = a.lastName.localeCompare(b.lastName, "es");
  if (lastNames !== 0) return lastNames;
  const firstNames = a.firstName.localeCompare(b.firstName, "es");
  if (firstNames !== 0) return firstNames;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Standings order: score desc, then rating desc (unrated last), then name. */
function byStandings(a: PairingPlayer, b: PairingPlayer): number {
  if (a.score !== b.score) return b.score - a.score;
  const ratingA = ratingKey(a);
  const ratingB = ratingKey(b);
  if (ratingA !== ratingB) return ratingB - ratingA;
  return compareByName(a, b);
}

/**
 * Bye order: lowest score group first, lowest rating inside it, and then the
 * player the seeding ranks *last* — the ranking runs alphabetically, so among
 * equally-rated players the bye falls on the one furthest down the list, the
 * same player round-1 seeding would have given it to.
 */
function byByePreference(a: PairingPlayer, b: PairingPlayer): number {
  if (a.score !== b.score) return a.score - b.score;
  const ratingA = ratingKey(a);
  const ratingB = ratingKey(b);
  if (ratingA !== ratingB) return ratingA - ratingB;
  return compareByName(b, a);
}

/**
 * FIDE C.04.1.d: a player may not receive the pairing-allocated bye if they
 * have already had one, or have already won a game by forfeit because an
 * opponent did not turn up — either way they have already been given a point
 * without playing.
 *
 * Who should get the bye, best candidate first, split by eligibility. Handing
 * a second free point to the same player skews the standings more than any
 * other concession, so the ineligible list is only consulted after every
 * other rule has already been tried and relaxed.
 */
function byeCandidates(players: PairingPlayer[]): {
  eligible: PairingPlayer[];
  repeat: PairingPlayer[];
} {
  const eligibleForBye = (p: PairingPlayer) => !p.hadBye && !p.hadForfeitWin;
  return {
    eligible: players.filter(eligibleForBye).sort(byByePreference),
    repeat: players.filter((p) => !eligibleForBye(p)).sort(byByePreference),
  };
}

/**
 * Subsets of `bracket` (as indices) that could float down, best first.
 *
 * Two preferences, in order. First, avoid making somebody float down twice in
 * a row: FIDE treats a repeated downfloat as a quality defect, since the same
 * player keeps being pushed away from their own score group. Second, among
 * subsets that are equal on that count, the lowest-rated players float, which
 * is the default shape of the system.
 *
 * Both are only preferences on the order the search tries things in, never
 * constraints: a subset that leaves the bracket unpairable is skipped, so
 * these can never cost a legal pairing.
 */
function floatChoices(bracket: PairingPlayer[], count: number): number[][] {
  const bracketSize = bracket.length;
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

  // Stable sort keeps the bottom-most-first order within each group, so the
  // rating preference still decides among equally good choices.
  const repeats = (combo: number[]) =>
    combo.reduce((n, i) => n + (bracket[i].downfloatedLastRound ? 1 : 0), 0);
  return combos
    .map((combo, order) => ({ combo, order, repeats: repeats(combo) }))
    .sort((x, y) => x.repeats - y.repeats || x.order - y.order)
    .map((entry) => entry.combo);
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
  bracketIndexOf: ReadonlyMap<number, number>,
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
      const span = Math.abs(
        (bracketIndexOf.get(scoreKey(a)) ?? 0) - (bracketIndexOf.get(scoreKey(b)) ?? 0),
      );
      if (span > relax.maxBracketSpan) continue;
      const rematch = a.opponents.has(b.id);
      if (rematch && !relax.rematch) continue;
      const colorOk = colorsCompatible(a, b);
      if (!colorOk && !relax.colorViolation) continue;
      const deviation = Math.abs(j - ideal[i]) + Math.abs(i - ideal[j]);
      let weight = FOLD_BASE - deviation * FOLD_STEP;
      if (rematch) weight -= REMATCH_PENALTY;
      if (colorOk) weight -= preferencePenalty(a, b);
      else weight -= COLOR_VIOLATION_PENALTY;
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
  bracketIndexOf: ReadonlyMap<number, number>,
): PairingPair[] | null {
  if (index >= groups.length) return floaters.length === 0 ? [] : null;

  const bracket = [...floaters, ...groups[index]].sort(byStandings);
  const isLast = index === groups.length - 1;
  // The last bracket has nowhere to float to: everyone left must be paired.
  const parity = bracket.length % 2;
  const maxDown = isLast ? 0 : Math.min(bracket.length, parity + MAX_EXTRA_FLOAT_PAIRS * 2);
  const residentScore = scoreKey(groups[index][0]);

  for (let down = parity; down <= maxDown; down += 2) {
    for (const downIndices of floatChoices(bracket, down)) {
      if (budget.attempts >= MAX_SEARCH_ATTEMPTS) return null;
      budget.attempts++;
      const downSet = new Set(downIndices);
      const stay = bracket.filter((_, i) => !downSet.has(i));
      const stayingFloaters = stay.filter((p) => scoreKey(p) !== residentScore).length;
      const paired = matchBracket(stay, stayingFloaters, relax, bracketIndexOf);
      if (!paired) continue;
      const tail = searchBrackets(
        groups,
        index + 1,
        downIndices.map((i) => bracket[i]),
        relax,
        budget,
        bracketIndexOf,
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
  // Which position each score group holds, so "one group apart" is measured
  // in groups that actually exist and not in points: with groups of 2, 1 and
  // 0.5, dropping from 2 to 1 is a single step even though it is a whole point.
  const bracketIndexOf = new Map<number, number>();
  groups.forEach((group, index) => bracketIndexOf.set(scoreKey(group[0]), index));

  return searchBrackets(groups, 0, [], relax, budget, bracketIndexOf);
}

// Weights for the whole-field fallback below. Score-group distance dominates
// the fold, a single color violation outweighs every score-group penalty
// combined, and a single repeat pairing outweighs every color violation.
const GLOBAL_SCORE_STEP = 10_000;

/**
 * Charged when the whole-field fallback makes somebody float down for the
 * second round running. Below one step of score distance, so keeping players
 * near their own score group still comes first.
 */
const REPEAT_FLOAT_PENALTY = 2_000;

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
  const bracketIndexOf = new Map<number, number>();
  [...groupHalf.keys()]
    .sort((a, b) => b - a)
    .forEach((key, index) => bracketIndexOf.set(key, index));

  const edges: Array<[number, number, number]> = [];
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const span = Math.abs(
        (bracketIndexOf.get(scoreKey(a)) ?? 0) - (bracketIndexOf.get(scoreKey(b)) ?? 0),
      );
      if (span > relax.maxBracketSpan) continue;
      const rematch = a.opponents.has(b.id);
      if (rematch && !relax.rematch) continue;
      const colorOk = colorsCompatible(a, b);
      if (!colorOk && !relax.colorViolation) continue;
      const scoreGap = Math.abs(scoreKey(a) - scoreKey(b));
      const sameGroup = scoreGap === 0;
      const idealSpan = sameGroup ? (groupHalf.get(scoreKey(a)) ?? 1) : 1;
      let weight =
        FOLD_BASE - scoreGap * GLOBAL_SCORE_STEP - Math.abs(j - i - idealSpan) * FOLD_STEP;
      // Across score groups the higher-scoring player is the one floating
      // down; charge for it if they already floated last round.
      if (!sameGroup) {
        const downfloater = scoreKey(a) > scoreKey(b) ? a : b;
        if (downfloater.downfloatedLastRound) weight -= REPEAT_FLOAT_PENALTY;
      }
      if (rematch) weight -= REMATCH_PENALTY;
      if (colorOk) weight -= preferencePenalty(a, b);
      else weight -= COLOR_VIOLATION_PENALTY;
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
 * Board order follows standard Swiss practice: the leading score group sits on
 * board 1, descending from there, so winners keep climbing to the top boards.
 *
 * A board is ranked by the *pair*, not by its best player: first the higher of
 * the two scores, then the lower. Ranking by the best player alone put a
 * float like 1-vs-0.5 above a full 1-vs-1 board whenever the floater happened
 * to outrank both players of the other board — a real complaint from a live
 * round, where a 0.5/1 board sat on 4 and a 1/1 board on 5. Only once two
 * boards hold the same pair of scores does rating decide.
 */
function orderBoards(pairs: PairingPair[], field: PairingPlayer[]): PairingPair[] {
  const rank = new Map<string, number>();
  const scoreOf = new Map<string, number>();
  [...field].sort(byStandings).forEach((player, i) => {
    rank.set(player.id, i);
    scoreOf.set(player.id, player.score);
  });
  const key = (pair: PairingPair) => {
    const white = scoreOf.get(pair.white) ?? 0;
    const black = scoreOf.get(pair.black) ?? 0;
    return {
      high: Math.max(white, black),
      low: Math.min(white, black),
      rank: Math.min(rank.get(pair.white) ?? Infinity, rank.get(pair.black) ?? Infinity),
    };
  };
  return [...pairs].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return y.high - x.high || y.low - x.low || x.rank - y.rank;
  });
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
  const groupCount = new Set(players.map((p) => scoreKey(p))).size;
  const relaxations = relaxationLadder(groupCount);
  const byes = byeCandidates(players);
  // Every rule is tried and relaxed against the players who may still take a
  // bye before a second bye is even considered.
  const stages: Array<Array<PairingPlayer | null>> = needsBye
    ? [byes.eligible, byes.repeat]
    : [[null]];

  for (const stage of stages) {
    if (stage.length === 0) continue;
    for (const relax of relaxations) {
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
