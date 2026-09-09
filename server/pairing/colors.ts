export type Color = "white" | "black";

/**
 * Strict constraint: a player may never end a round with more games of one
 * color than the other plus one. 3W/2B is fine, 4W/1B is not.
 */
export const MAX_COLOR_DIFFERENCE = 1;

/** Strict constraint: a player may never play the same color three rounds running. */
export const MAX_SAME_COLOR_STREAK = 2;

export type PreferenceStrength = "absolute" | "mild" | "none";

export interface ColorPreference {
  /** The color the player is due, or null when either is equally fine. */
  due: Color | null;
  /**
   * "absolute" — the other color would break one of the strict constraints.
   * "mild" — plain alternation; can be given up to resolve a conflict.
   */
  strength: PreferenceStrength;
}

/** Everything the color rules need to know about a player. */
export interface ColorCandidate {
  id: string;
  rating: number | null;
  /** Colors already played, oldest first. Byes are not colors and are not listed. */
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
 * Whether handing `color` to this player would break either strict constraint:
 * the running balance leaving [-1, 1], or a third game in a row with the same
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
  const last = history[history.length - 1];
  if (last === undefined) return { due: null, strength: "none" };
  return { due: opposite(last), strength: "mild" };
}

/** True when the pair admits an assignment that breaks no strict constraint. */
export function colorsCompatible(a: ColorCandidate, b: ColorCandidate): boolean {
  return (
    (!violatesColorRules(a.colorHistory, "white") && !violatesColorRules(b.colorHistory, "black")) ||
    (!violatesColorRules(a.colorHistory, "black") && !violatesColorRules(b.colorHistory, "white"))
  );
}

/** Deterministic "who decides" ordering: higher rating first, unrated last, then id. */
function outranks(a: ColorCandidate, b: ColorCandidate): boolean {
  const ratingA = a.rating ?? -Infinity;
  const ratingB = b.rating ?? -Infinity;
  if (ratingA !== ratingB) return ratingA > ratingB;
  return a.id < b.id;
}

function give(player: ColorCandidate, color: Color, other: ColorCandidate) {
  return color === "white"
    ? { white: player.id, black: other.id }
    : { white: other.id, black: player.id };
}

/**
 * Decide who plays white. Any assignment that keeps both players inside the
 * strict constraints wins outright; when both (or, under relaxation, neither)
 * are legal, preferences decide, and a head-on conflict goes to the
 * higher-rated player.
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
  if (prefA.due && !prefB.due) return give(a, prefA.due, b);
  if (prefB.due && !prefA.due) return give(b, prefB.due, a);
  if (prefA.due && prefB.due) {
    if (prefA.due !== prefB.due) return give(a, prefA.due, b);
    return outranks(a, b) ? give(a, prefA.due, b) : give(b, prefB.due, a);
  }
  // No history on either side (round 1 is handled separately): top seed takes white.
  return outranks(a, b) ? { white: a.id, black: b.id } : { white: b.id, black: a.id };
}
