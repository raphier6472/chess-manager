export type Color = "white" | "black";

/**
 * FIDE C.04.1.f: for each player the difference between games played with
 * white and with black must stay within [-2, +2]. 4W/2B is fine, 5W/2B is not.
 */
export const MAX_COLOR_DIFFERENCE = 2;

/** FIDE C.04.1.g: no player receives the same color three rounds running. */
export const MAX_SAME_COLOR_STREAK = 2;

/**
 * FIDE C.04.3 grades how badly a player wants a color:
 *
 * - "absolute" — the other color would break C.04.1.f or C.04.1.g. Must be
 *   granted; two players with conflicting absolute preferences cannot be
 *   paired at all.
 * - "strong" — the color difference is +1 or -1, so the player is due the
 *   color that equalizes it.
 * - "mild" — colors are balanced; the player is due the one that alternates
 *   from their last game.
 */
export type PreferenceStrength = "absolute" | "strong" | "mild" | "none";

const STRENGTH_RANK: Record<PreferenceStrength, number> = {
  absolute: 3,
  strong: 2,
  mild: 1,
  none: 0,
};

export interface ColorPreference {
  /** The color the player is due, or null when either is equally fine. */
  due: Color | null;
  strength: PreferenceStrength;
}

/** Everything the color rules need to know about a player. */
export interface ColorCandidate {
  id: string;
  /** Used to separate two players of equal rating, as the seeding does. */
  lastName: string;
  firstName: string;
  rating: number | null;
  /**
   * Colors of the games this player actually played, oldest first. Byes and
   * forfeited games are not colors and must not appear here — FIDE counts the
   * color difference and the color sequence over played games only.
   */
  colorHistory: readonly Color[];
}

export function opposite(color: Color): Color {
  return color === "white" ? "black" : "white";
}

/** Positive = played white more often than black. */
export function colorBalance(history: readonly Color[]): number {
  let balance = 0;
  for (const color of history) balance += color === "white" ? 1 : -1;
  return balance;
}

/** The run of identical colors at the end of the history. */
export function trailingStreak(history: readonly Color[]): { color: Color | null; length: number } {
  if (history.length === 0) return { color: null, length: 0 };
  const color = history[history.length - 1];
  let length = 1;
  while (length < history.length && history[history.length - 1 - length] === color) length++;
  return { color, length };
}

/**
 * Whether handing `color` to this player would break either hard rule: the
 * running difference leaving [-2, +2], or a third game in a row with the same
 * color.
 */
export function violatesColorRules(history: readonly Color[], color: Color): boolean {
  const balance = colorBalance(history) + (color === "white" ? 1 : -1);
  if (Math.abs(balance) > MAX_COLOR_DIFFERENCE) return true;
  const streak = trailingStreak(history);
  return streak.color === color && streak.length + 1 > MAX_SAME_COLOR_STREAK;
}

export function colorPreference(history: readonly Color[]): ColorPreference {
  const whiteOk = !violatesColorRules(history, "white");
  const blackOk = !violatesColorRules(history, "black");
  if (whiteOk && !blackOk) return { due: "white", strength: "absolute" };
  if (blackOk && !whiteOk) return { due: "black", strength: "absolute" };
  if (!whiteOk && !blackOk) {
    // Only reachable when an earlier round had to break the rules to pair at
    // all. Steer back towards balance instead of giving up on a preference.
    const balance = colorBalance(history);
    if (balance === 0) return { due: null, strength: "none" };
    return { due: balance > 0 ? "black" : "white", strength: "absolute" };
  }

  const balance = colorBalance(history);
  if (balance !== 0) return { due: balance > 0 ? "black" : "white", strength: "strong" };
  const last = history[history.length - 1];
  if (last === undefined) return { due: null, strength: "none" };
  return { due: opposite(last), strength: "mild" };
}

/** True when the pair admits an assignment that breaks no hard rule. */
export function colorsCompatible(a: ColorCandidate, b: ColorCandidate): boolean {
  return (
    (!violatesColorRules(a.colorHistory, "white") && !violatesColorRules(b.colorHistory, "black")) ||
    (!violatesColorRules(a.colorHistory, "black") && !violatesColorRules(b.colorHistory, "white"))
  );
}

/**
 * Deterministic "who decides" ordering: higher rating first, unrated last,
 * then alphabetically by surname and given name — the same ranking the
 * seeding uses, so the arbiter can explain why one of two equally-rated
 * players got the color (FIDE C.04.1.i). The id is only a last resort.
 */
function outranks(a: ColorCandidate, b: ColorCandidate): boolean {
  const ratingA = a.rating ?? -Infinity;
  const ratingB = b.rating ?? -Infinity;
  if (ratingA !== ratingB) return ratingA > ratingB;
  const lastNames = a.lastName.localeCompare(b.lastName, "es");
  if (lastNames !== 0) return lastNames < 0;
  const firstNames = a.firstName.localeCompare(b.firstName, "es");
  if (firstNames !== 0) return firstNames < 0;
  return a.id < b.id;
}

/**
 * Which of the two players loses the argument when both are due the same
 * color, or null when nobody has to give anything up. FIDE C.04.3: the
 * stronger preference is granted, and between equal strengths the
 * higher-ranked player wins.
 */
function loser(a: ColorCandidate, b: ColorCandidate): ColorCandidate | null {
  const prefA = colorPreference(a.colorHistory);
  const prefB = colorPreference(b.colorHistory);
  if (!prefA.due || !prefB.due || prefA.due !== prefB.due) return null;
  const rankA = STRENGTH_RANK[prefA.strength];
  const rankB = STRENGTH_RANK[prefB.strength];
  if (rankA !== rankB) return rankA > rankB ? b : a;
  return outranks(a, b) ? b : a;
}

/**
 * The strength of the color preference that has to be denied to play this
 * pair, or null when both players can be given the color they are due. The
 * pairing weights use it so that, with the looser +/-2 limit, a pairing that
 * satisfies everyone still beats one that does not.
 */
export function deniedPreference(a: ColorCandidate, b: ColorCandidate): PreferenceStrength | null {
  const denied = loser(a, b);
  if (!denied) return null;
  return colorPreference(denied.colorHistory).strength;
}

function give(player: ColorCandidate, color: Color, other: ColorCandidate) {
  return color === "white"
    ? { white: player.id, black: other.id }
    : { white: other.id, black: player.id };
}

/**
 * Decide who plays white. Any assignment that keeps both players inside the
 * hard rules wins outright; when both (or, under relaxation, neither) are
 * legal, FIDE C.04.3 decides: grant both preferences if they differ, else
 * grant the stronger one, and break a tie in favor of the higher-rated player.
 */
export function assignColors(
  a: ColorCandidate,
  b: ColorCandidate,
): { white: string; black: string } {
  const aWhiteOk =
    !violatesColorRules(a.colorHistory, "white") && !violatesColorRules(b.colorHistory, "black");
  const aBlackOk =
    !violatesColorRules(a.colorHistory, "black") && !violatesColorRules(b.colorHistory, "white");
  if (aWhiteOk && !aBlackOk) return { white: a.id, black: b.id };
  if (aBlackOk && !aWhiteOk) return { white: b.id, black: a.id };

  const prefA = colorPreference(a.colorHistory);
  const prefB = colorPreference(b.colorHistory);
  if (prefA.due && prefB.due) {
    // Different colors due: both get what they want.
    if (prefA.due !== prefB.due) return give(a, prefA.due, b);
    const denied = loser(a, b)!;
    const winner = denied === a ? b : a;
    return give(winner, colorPreference(winner.colorHistory).due!, denied);
  }
  if (prefA.due) return give(a, prefA.due, b);
  if (prefB.due) return give(b, prefB.due, a);
  // No history on either side (round 1 is handled separately): top seed takes white.
  return outranks(a, b) ? { white: a.id, black: b.id } : { white: b.id, black: a.id };
}
