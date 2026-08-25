import { describe, expect, it } from "vitest";
import { generatePairings, type PairingPlayer } from "./pairing";

function player(
  id: string,
  score: number,
  opts: Partial<Omit<PairingPlayer, "id" | "score">> = {},
): PairingPlayer {
  return {
    id,
    score,
    colorBalance: 0,
    opponents: new Set(),
    hadBye: false,
    ...opts,
  };
}

describe("generatePairings", () => {
  it("pairs all 4 players with no history, none unmatched", () => {
    const players = [player("a", 0), player("b", 0), player("c", 0), player("d", 0)];
    const { pairs, bye } = generatePairings(players);
    expect(bye).toBeNull();
    expect(pairs).toHaveLength(2);
    const paired = new Set(pairs.flatMap((p) => [p.white, p.black]));
    expect(paired).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("never repeats an existing pairing when an alternative exists", () => {
    // a already played b. With c and d available, a-b must not repeat.
    const players = [
      player("a", 1, { opponents: new Set(["b"]) }),
      player("b", 1, { opponents: new Set(["a"]) }),
      player("c", 1),
      player("d", 1),
    ];
    const { pairs } = generatePairings(players);
    const rematch = pairs.some(
      (p) => (p.white === "a" && p.black === "b") || (p.white === "b" && p.black === "a"),
    );
    expect(rematch).toBe(false);
  });

  it("assigns a bye to exactly one player with an odd headcount", () => {
    const players = [player("a", 2), player("b", 1), player("c", 1), player("d", 0), player("e", 0)];
    const { pairs, bye } = generatePairings(players);
    expect(bye).not.toBeNull();
    expect(pairs).toHaveLength(2);
    const paired = new Set(pairs.flatMap((p) => [p.white, p.black]));
    paired.add(bye!);
    expect(paired.size).toBe(5);
  });

  it("gives the bye to the lowest-scoring player among those without a previous bye", () => {
    const players = [
      player("a", 3),
      player("b", 2),
      player("c", 1),
      player("d", 0, { hadBye: true }),
      player("e", 0),
    ];
    const { bye } = generatePairings(players);
    // "d" already had a bye and is tied for lowest score with "e";
    // "e" (lowest score without a previous bye) should get it instead.
    expect(bye).toBe("e");
  });

  it("prefers pairing within the same score group over strict score order", () => {
    const players = [
      player("a", 2),
      player("b", 2),
      player("c", 1),
      player("d", 1),
    ];
    const { pairs } = generatePairings(players);
    const setOf = (p: { white: string; black: string }) => new Set([p.white, p.black]);
    const hasPair = (x: string, y: string) => pairs.some((p) => setOf(p).has(x) && setOf(p).has(y));
    expect(hasPair("a", "b")).toBe(true);
    expect(hasPair("c", "d")).toBe(true);
  });

  it("assigns white to whoever is more owed it by color balance", () => {
    const players = [
      player("a", 0, { colorBalance: 2 }), // played white twice more than black
      player("b", 0, { colorBalance: -1 }), // owed white
    ];
    const { pairs } = generatePairings(players);
    expect(pairs).toEqual([{ white: "b", black: "a" }]);
  });
});
