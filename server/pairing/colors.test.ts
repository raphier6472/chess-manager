import { describe, expect, it } from "vitest";
import {
  assignColors,
  colorBalance,
  colorPreference,
  colorsCompatible,
  trailingStreak,
  violatesColorRules,
  type Color,
} from "./colors";

const W: Color = "white";
const B: Color = "black";

function candidate(id: string, rating: number | null, colorHistory: Color[]) {
  return { id, rating, colorHistory };
}

describe("colorBalance", () => {
  it("counts whites positive and blacks negative", () => {
    expect(colorBalance([])).toBe(0);
    expect(colorBalance([W, B, W])).toBe(1);
    expect(colorBalance([B, B])).toBe(-2);
  });
});

describe("trailingStreak", () => {
  it("measures only the run at the end of the history", () => {
    expect(trailingStreak([])).toEqual({ color: null, length: 0 });
    expect(trailingStreak([W, B, B])).toEqual({ color: B, length: 2 });
    expect(trailingStreak([B, B, W])).toEqual({ color: W, length: 1 });
  });
});

describe("violatesColorRules", () => {
  it("refuses a color that would push the balance past one", () => {
    // 1W/0B: another white is 2W/0B, a difference of 2.
    expect(violatesColorRules([W], W)).toBe(true);
    expect(violatesColorRules([W], B)).toBe(false);
    // 3W/2B is fine, 4W/1B is not.
    expect(violatesColorRules([W, B, W, B, W], B)).toBe(false);
    expect(violatesColorRules([W, B, W, W, B], W)).toBe(true);
  });

  it("refuses a third game in a row with the same color", () => {
    // Reachable only after a round that had to break the balance rule; the
    // streak rule still has to hold on its own.
    expect(violatesColorRules([B, W, W], W)).toBe(true);
    expect(violatesColorRules([B, W, W], B)).toBe(false);
  });

  it("allows either color to a player with no history", () => {
    expect(violatesColorRules([], W)).toBe(false);
    expect(violatesColorRules([], B)).toBe(false);
  });
});

describe("colorPreference", () => {
  it("has no preference before the first round", () => {
    expect(colorPreference([])).toEqual({ due: null, strength: "none" });
  });

  it("is absolute whenever the other color would break a strict rule", () => {
    expect(colorPreference([W])).toEqual({ due: B, strength: "absolute" });
    expect(colorPreference([B])).toEqual({ due: W, strength: "absolute" });
  });

  it("is a mild alternation preference when both colors are legal", () => {
    expect(colorPreference([W, B])).toEqual({ due: W, strength: "mild" });
    expect(colorPreference([B, W])).toEqual({ due: B, strength: "mild" });
  });

  it("steers back towards balance when a past round already broke the rules", () => {
    // 3W/0B: both colors are now illegal, so aim at the one that repairs it.
    expect(colorPreference([W, W, W])).toEqual({ due: B, strength: "absolute" });
  });
});

describe("colorsCompatible", () => {
  it("rejects two players who both strictly need the same color", () => {
    const a = candidate("a", 2000, [W]);
    const b = candidate("b", 1500, [W]);
    expect(colorsCompatible(a, b)).toBe(false);
  });

  it("accepts two players who strictly need opposite colors", () => {
    expect(colorsCompatible(candidate("a", 2000, [W]), candidate("b", 1500, [B]))).toBe(true);
  });

  it("accepts a pair where at least one side is free", () => {
    expect(colorsCompatible(candidate("a", 2000, [W]), candidate("b", 1500, []))).toBe(true);
  });
});

describe("assignColors", () => {
  it("gives each player the only color that keeps them inside the rules", () => {
    // a is due black (played white), b is due white (played black).
    const pair = assignColors(candidate("a", 2000, [W]), candidate("b", 1500, [B]));
    expect(pair).toEqual({ white: "b", black: "a" });
  });

  it("honours an absolute preference over a free opponent", () => {
    const pair = assignColors(candidate("free", 2000, []), candidate("owed", 1500, [W]));
    // "owed" must play black, so "free" takes white even though it is not owed it.
    expect(pair).toEqual({ white: "free", black: "owed" });
  });

  it("gives the higher-rated player their color when both are due the same one", () => {
    // Both are balanced (1W/1B) and both last played black, so both mildly
    // want white; rule: the higher-rated player gets their preference.
    const pair = assignColors(candidate("strong", 2000, [W, B]), candidate("weak", 1500, [W, B]));
    expect(pair).toEqual({ white: "strong", black: "weak" });
  });

  it("gives white to the higher-rated player when neither has any history", () => {
    expect(assignColors(candidate("a", 1500, []), candidate("b", 2000, []))).toEqual({
      white: "b",
      black: "a",
    });
  });

  it("treats an unrated player as the lower-rated one", () => {
    expect(assignColors(candidate("unrated", null, []), candidate("rated", 1000, []))).toEqual({
      white: "rated",
      black: "unrated",
    });
  });
});
