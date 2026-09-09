import { describe, expect, it } from "vitest";
import {
  assignColors,
  colorBalance,
  colorPreference,
  colorsCompatible,
  deniedPreference,
  trailingStreak,
  violatesColorRules,
  type Color,
} from "./colors";

const W: Color = "white";
const B: Color = "black";

function candidate(id: string, rating: number | null, colorHistory: Color[]) {
  // The surname doubles as the id so equal-rating ties stay deterministic.
  return { id, lastName: id, firstName: "", rating, colorHistory };
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
  it("allows the balance to reach two, as FIDE C.04.1.f does", () => {
    // 1W/0B going to 2W/0B is a difference of 2, which FIDE permits.
    expect(violatesColorRules([W], W)).toBe(false);
    expect(violatesColorRules([W], B)).toBe(false);
  });

  it("refuses a color that would push the balance past two", () => {
    // 3W/1B: another white is 4W/1B, a difference of 3.
    expect(violatesColorRules([W, W, B, W], W)).toBe(true);
    expect(violatesColorRules([W, W, B, W], B)).toBe(false);
  });

  it("refuses a third game in a row with the same color", () => {
    // FIDE C.04.1.g, and it bites before the balance rule does: 2W/0B is a
    // legal difference, but a third white in a row is not allowed.
    expect(violatesColorRules([W, W], W)).toBe(true);
    expect(violatesColorRules([W, W], B)).toBe(false);
    expect(violatesColorRules([B, W, W], W)).toBe(true);
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

  it("is strong when the balance is off by one (FIDE: equalize)", () => {
    expect(colorPreference([W])).toEqual({ due: B, strength: "strong" });
    expect(colorPreference([B])).toEqual({ due: W, strength: "strong" });
  });

  it("is absolute whenever the other color would break a hard rule", () => {
    // Two whites already: a third would break the streak rule.
    expect(colorPreference([W, W])).toEqual({ due: B, strength: "absolute" });
    // 3W/1B: another white would make the difference 3.
    expect(colorPreference([W, W, B, W])).toEqual({ due: B, strength: "absolute" });
  });

  it("is a mild alternation preference when colors are balanced", () => {
    expect(colorPreference([W, B])).toEqual({ due: W, strength: "mild" });
    expect(colorPreference([B, W])).toEqual({ due: B, strength: "mild" });
  });

  it("steers back towards balance when a past round already broke the rules", () => {
    // 3W/0B: both colors are now illegal, so aim at the one that repairs it.
    expect(colorPreference([W, W, W])).toEqual({ due: B, strength: "absolute" });
  });
});

describe("colorsCompatible", () => {
  it("rejects two players who both absolutely need the same color", () => {
    // Both have played two whites running, so neither can take white again.
    const a = candidate("a", 2000, [W, W]);
    const b = candidate("b", 1500, [W, W]);
    expect(colorsCompatible(a, b)).toBe(false);
  });

  it("accepts two players who merely have the same strong preference", () => {
    // Both are 1W/0B and due black. Under FIDE one of them can still take
    // white and go to 2W/0B, so the pairing is legal — just not ideal.
    expect(colorsCompatible(candidate("a", 2000, [W]), candidate("b", 1500, [W]))).toBe(true);
  });

  it("accepts a pair where at least one side is free", () => {
    expect(colorsCompatible(candidate("a", 2000, [W]), candidate("b", 1500, []))).toBe(true);
  });
});

describe("deniedPreference", () => {
  it("reports nobody denied when the two are due opposite colors", () => {
    expect(deniedPreference(candidate("a", 2000, [W]), candidate("b", 1500, [B]))).toBeNull();
  });

  it("reports a denied strong preference when both are due the same color", () => {
    expect(deniedPreference(candidate("a", 2000, [W]), candidate("b", 1500, [W]))).toBe("strong");
  });

  it("reports a denied mild preference when both merely want to alternate", () => {
    expect(deniedPreference(candidate("a", 2000, [W, B]), candidate("b", 1500, [W, B]))).toBe(
      "mild",
    );
  });

  it("denies the weaker preference, not the lower-rated player", () => {
    // Both are due black: "strong" is 1W/0B and needs it to equalize, while
    // "mild" is balanced and merely wants to alternate. FIDE grants the
    // stronger preference even though the player holding it is rated lower.
    const strong = candidate("strong", 1500, [W]);
    const mild = candidate("mild", 2000, [B, W]);
    expect(colorPreference(strong.colorHistory).due).toBe(B);
    expect(colorPreference(mild.colorHistory).due).toBe(B);
    expect(deniedPreference(strong, mild)).toBe("mild");
    expect(assignColors(strong, mild)).toEqual({ white: "mild", black: "strong" });
  });
});

describe("assignColors", () => {
  it("gives each player the color they are due when the two differ", () => {
    // a is due black (played white), b is due white (played black).
    const pair = assignColors(candidate("a", 2000, [W]), candidate("b", 1500, [B]));
    expect(pair).toEqual({ white: "b", black: "a" });
  });

  it("grants the absolute preference when the opponent only has a strong one", () => {
    // "streak" has two whites running and cannot take a third under any
    // circumstances; "owed" merely prefers black to equalize and has to yield.
    const pair = assignColors(candidate("owed", 2000, [W]), candidate("streak", 1500, [W, W]));
    expect(pair).toEqual({ white: "owed", black: "streak" });
  });

  it("honours a preference over an opponent who has none", () => {
    const pair = assignColors(candidate("free", 2000, []), candidate("owed", 1500, [W]));
    // "owed" is due black, so "free" takes white even though it is not owed it.
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
