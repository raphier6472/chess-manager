import { describe, expect, it } from "vitest";
import {
  generateInitialPairings,
  generatePairings,
  type Color,
  type PairingPair,
  type PairingPlayer,
  type SeedPlayer,
} from "./pairing";
import { colorBalance, colorsCompatible, MAX_COLOR_DIFFERENCE, trailingStreak } from "./colors";
import { maxWeightMatching } from "./blossom";

const W: Color = "white";
const B: Color = "black";

function player(
  id: string,
  score: number,
  opts: Partial<Omit<PairingPlayer, "id" | "score">> = {},
): PairingPlayer {
  return {
    id,
    // The surname defaults to the id so equal-rating ties stay deterministic
    // in tests that do not care about names.
    lastName: id,
    firstName: "",
    score,
    colorHistory: [],
    opponents: new Set(),
    hadBye: false,
    hadForfeitWin: false,
    downfloatedLastRound: false,
    rating: null,
    ...opts,
  };
}

/** Who `id` was paired against this round, or null if they are not playing. */
function opponentOf(pairs: PairingPair[], id: string): string | null {
  const pair = pairs.find((p) => p.white === id || p.black === id);
  if (!pair) return null;
  return pair.white === id ? pair.black : pair.white;
}

function paired(pairs: PairingPair[], x: string, y: string): boolean {
  return opponentOf(pairs, x) === y;
}

describe("generatePairings — grupos de puntaje y plegado por Elo", () => {
  it("pairs all 4 players with no history, none unmatched", () => {
    const players = [player("a", 0), player("b", 0), player("c", 0), player("d", 0)];
    const { pairs, bye } = generatePairings(players);
    expect(bye).toBeNull();
    expect(pairs).toHaveLength(2);
    const seen = new Set(pairs.flatMap((p) => [p.white, p.black]));
    expect(seen).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("folds a score group top half against bottom half by rating", () => {
    // Regla 2: dentro del grupo, #1 de la mitad de arriba contra #1 de la de
    // abajo. Con 2000/1900/1000/900 eso es 2000-1000 y 1900-900, nunca
    // 2000-1900 (que sería emparejar dentro de la misma mitad).
    const players = [
      player("r1000", 1, { rating: 1000 }),
      player("r2000", 1, { rating: 2000 }),
      player("r900", 1, { rating: 900 }),
      player("r1900", 1, { rating: 1900 }),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "r2000", "r1000")).toBe(true);
    expect(paired(pairs, "r1900", "r900")).toBe(true);
  });

  it("keeps players inside their exact score group when the groups are even", () => {
    const players = [
      player("top1", 2, { rating: 2000 }),
      player("top2", 2, { rating: 1000 }),
      player("low1", 1, { rating: 1900 }),
      player("low2", 1, { rating: 900 }),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "top1", "top2")).toBe(true);
    expect(paired(pairs, "low1", "low2")).toBe(true);
  });

  it("separates score groups that differ by only half a point", () => {
    const players = [
      player("a", 1.5, { rating: 2000 }),
      player("b", 1.5, { rating: 1000 }),
      player("c", 1, { rating: 1900 }),
      player("d", 1, { rating: 900 }),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "a", "b")).toBe(true);
    expect(paired(pairs, "c", "d")).toBe(true);
  });

  it("prefers pairing within the same score group over strict score order", () => {
    const players = [player("a", 2), player("b", 2), player("c", 1), player("d", 1)];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "a", "b")).toBe(true);
    expect(paired(pairs, "c", "d")).toBe(true);
  });

  it("puts the highest-rated player of the highest score group on board 1", () => {
    // Regresión de un torneo real: el orden de mesas solo comparaba puntaje,
    // así que dos parejas empatadas quedaban en el orden arbitrario que
    // devolviera la base y el Elo más alto podía terminar en la mesa 2.
    const players = [
      player("h900", 1, { rating: 900 }),
      player("g1000", 1, { rating: 1000 }),
      player("a2000", 1, { rating: 2000 }),
      player("b1900", 1, { rating: 1900 }),
    ];
    const { pairs } = generatePairings(players);
    expect(pairs).toHaveLength(2);
    expect([pairs[0].white, pairs[0].black]).toContain("a2000");
    expect([pairs[1].white, pairs[1].black]).toContain("h900");
  });

  it("sorts boards by score group before rating", () => {
    const players = [
      player("leader", 2, { rating: 1000 }),
      player("second", 2, { rating: 900 }),
      player("strong", 0, { rating: 2500 }),
      player("weak", 0, { rating: 2400 }),
    ];
    const { pairs } = generatePairings(players);
    expect([pairs[0].white, pairs[0].black].sort()).toEqual(["leader", "second"]);
  });
});

describe("generatePairings — colores", () => {
  it("alternates colors when the fold pairing allows it", () => {
    // Cada uno debe recibir el color opuesto al de la ronda anterior.
    const players = [
      player("a", 1, { rating: 2000, colorHistory: [W] }),
      player("b", 1, { rating: 1900, colorHistory: [B] }),
      player("c", 1, { rating: 1000, colorHistory: [B] }),
      player("d", 1, { rating: 900, colorHistory: [W] }),
    ];
    const { pairs } = generatePairings(players);
    expect(pairs).toContainEqual({ white: "c", black: "a" });
    expect(pairs).toContainEqual({ white: "b", black: "d" });
  });

  it("deviates from the fold rather than forcing the same color on both players", () => {
    // El plegado ideal sería 2000-1000 y 1900-900, pero en cada una de esas
    // parejas los dos vienen del mismo color y uno quedaría en 2W/0B. El
    // emparejamiento se corre a la alternativa legal que menos rompe el
    // plegado: sigue siendo mitad de arriba contra mitad de abajo.
    const players = [
      player("w2000", 1, { rating: 2000, colorHistory: [W] }),
      player("b1900", 1, { rating: 1900, colorHistory: [B] }),
      player("w1000", 1, { rating: 1000, colorHistory: [W] }),
      player("b900", 1, { rating: 900, colorHistory: [B] }),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "w2000", "b900")).toBe(true);
    expect(paired(pairs, "b1900", "w1000")).toBe(true);
    for (const pair of pairs) {
      expect(pair.white).not.toBe("w2000");
      expect(pair.white).not.toBe("w1000");
    }
  });

  it("never lets a player take the same color three rounds running", () => {
    // Historial ya irregular (una ronda anterior tuvo que forzar el color):
    // "streak" viene de dos blancas seguidas y no puede recibir una tercera.
    const players = [
      player("streak", 1, { rating: 2000, colorHistory: [B, W, W] }),
      player("free", 1, { rating: 1900, colorHistory: [W, B, B] }),
    ];
    const { pairs } = generatePairings(players);
    expect(pairs).toEqual([{ white: "free", black: "streak" }]);
  });

  it("gives the higher-rated player their color when both are due the same one", () => {
    const players = [
      player("strong", 1, { rating: 2000, colorHistory: [W, B] }),
      player("weak", 1, { rating: 1500, colorHistory: [W, B] }),
    ];
    const { pairs } = generatePairings(players);
    expect(pairs).toEqual([{ white: "strong", black: "weak" }]);
  });

  it("gives white to whoever is owed it", () => {
    const players = [
      player("a", 0, { rating: 2000, colorHistory: [W] }),
      player("b", 0, { rating: 1500, colorHistory: [B] }),
    ];
    const { pairs } = generatePairings(players);
    expect(pairs).toEqual([{ white: "b", black: "a" }]);
  });
});

describe("generatePairings — sin revanchas", () => {
  it("never repeats an existing pairing when an alternative exists", () => {
    const players = [
      player("a", 1, { opponents: new Set(["b"]) }),
      player("b", 1, { opponents: new Set(["a"]) }),
      player("c", 1),
      player("d", 1),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "a", "b")).toBe(false);
  });

  it("backtracks when both ideal fold partners in a group have already met", () => {
    // El plegado querría a-c y b-d, pero esas dos parejas ya se jugaron. La
    // única alternativa sin revancha que conserva el plegado es a-d y b-c.
    const players = [
      player("a", 1, { rating: 2000, opponents: new Set(["c"]) }),
      player("b", 1, { rating: 1900, opponents: new Set(["d"]) }),
      player("c", 1, { rating: 1000, opponents: new Set(["a"]) }),
      player("d", 1, { rating: 900, opponents: new Set(["b"]) }),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "a", "d")).toBe(true);
    expect(paired(pairs, "b", "c")).toBe(true);
  });

  it("breaks the score group rather than repeat a pairing", () => {
    // Los dos del grupo de arriba ya se enfrentaron y los dos de abajo
    // también: la única salida sin revanchas es cruzar los grupos.
    const players = [
      player("top1", 1, { rating: 2000, opponents: new Set(["top2"]) }),
      player("top2", 1, { rating: 1900, opponents: new Set(["top1"]) }),
      player("low1", 0, { rating: 1000, opponents: new Set(["low2"]) }),
      player("low2", 0, { rating: 900, opponents: new Set(["low1"]) }),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "top1", "top2")).toBe(false);
    expect(paired(pairs, "low1", "low2")).toBe(false);
  });

  it("prefers repeating a pairing over leaving players unpaired", () => {
    // Todos contra todos ya jugado: no queda ninguna pareja nueva posible,
    // así que la ronda igual se arma en vez de fallar.
    const all = ["a", "b", "c", "d"];
    const players = all.map((id) =>
      player(id, 1, { opponents: new Set(all.filter((other) => other !== id)) }),
    );
    const { pairs, bye } = generatePairings(players);
    expect(bye).toBeNull();
    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.flatMap((p) => [p.white, p.black]))).toEqual(new Set(all));
  });
});

describe("generatePairings — flotantes", () => {
  it("floats the lowest-rated player of an odd group onto the top of the next", () => {
    const players = [
      player("t2000", 1, { rating: 2000 }),
      player("t1500", 1, { rating: 1500 }),
      player("t1000", 1, { rating: 1000 }),
      player("b900", 0, { rating: 900 }),
      player("b800", 0, { rating: 800 }),
      player("b700", 0, { rating: 700 }),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "t2000", "t1500")).toBe(true);
    // El más bajo del grupo de arriba baja y juega contra el más alto del de abajo.
    expect(paired(pairs, "t1000", "b900")).toBe(true);
    expect(paired(pairs, "b800", "b700")).toBe(true);
  });

  it("cascades floats down through several score groups", () => {
    // 3 + 4 + 3: el grupo de 2 baja uno, eso deja al grupo de 1 en impar y
    // baja otro, y el de 0 absorbe los dos.
    const players = [
      player("a0", 2, { rating: 2200 }),
      player("a1", 2, { rating: 2100 }),
      player("a2", 2, { rating: 2000 }),
      player("b0", 1, { rating: 1900 }),
      player("b1", 1, { rating: 1800 }),
      player("b2", 1, { rating: 1700 }),
      player("b3", 1, { rating: 1600 }),
      player("c0", 0, { rating: 1500 }),
      player("c1", 0, { rating: 1400 }),
      player("c2", 0, { rating: 1300 }),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "a0", "a1")).toBe(true);
    // a2 flota y toma al mejor del grupo de 1; b3 queda impar y flota al de 0.
    expect(paired(pairs, "a2", "b0")).toBe(true);
    expect(paired(pairs, "b1", "b2")).toBe(true);
    expect(paired(pairs, "b3", "c0")).toBe(true);
    expect(paired(pairs, "c1", "c2")).toBe(true);
  });

  it("floats a different player when the preferred floater cannot be paired below", () => {
    // "c" es el más bajo del grupo de 1 y debería flotar, pero ya jugó contra
    // los tres del grupo de 0, así que el algoritmo retrocede y baja a "b".
    const players = [
      player("a", 1, { rating: 2000 }),
      player("b", 1, { rating: 1900 }),
      player("c", 1, { rating: 1000, opponents: new Set(["d", "e", "f"]) }),
      player("d", 0, { rating: 900, opponents: new Set(["c"]) }),
      player("e", 0, { rating: 800, opponents: new Set(["c"]) }),
      player("f", 0, { rating: 700, opponents: new Set(["c"]) }),
    ];
    const { pairs } = generatePairings(players);
    expect(paired(pairs, "a", "c")).toBe(true);
    expect(paired(pairs, "b", "d")).toBe(true);
    expect(paired(pairs, "e", "f")).toBe(true);
  });
});

describe("generatePairings — bye", () => {
  it("assigns a bye to exactly one player with an odd headcount", () => {
    const players = [player("a", 2), player("b", 1), player("c", 1), player("d", 0), player("e", 0)];
    const { pairs, bye } = generatePairings(players);
    expect(bye).not.toBeNull();
    expect(pairs).toHaveLength(2);
    const seen = new Set(pairs.flatMap((p) => [p.white, p.black]));
    seen.add(bye!);
    expect(seen.size).toBe(5);
  });

  it("gives the bye to the lowest-rated player of the lowest score group", () => {
    // No alcanza con "el de menor puntaje": dentro del último grupo manda el Elo.
    const players = [
      player("a", 1, { rating: 2000 }),
      player("b", 1, { rating: 1900 }),
      player("c", 1, { rating: 1800 }),
      player("low1000", 0, { rating: 1000 }),
      player("low800", 0, { rating: 800 }),
    ];
    const { bye } = generatePairings(players);
    expect(bye).toBe("low800");
  });

  it("treats an unrated player as the lowest-rated of their group", () => {
    const players = [
      player("a", 1, { rating: 2000 }),
      player("b", 1, { rating: 1900 }),
      player("c", 1, { rating: 1800 }),
      player("rated", 0, { rating: 800 }),
      player("unrated", 0, { rating: null }),
    ];
    const { bye } = generatePairings(players);
    expect(bye).toBe("unrated");
  });

  it("falls back to the next eligible player when the lowest already had a bye", () => {
    const players = [
      player("a", 3),
      player("b", 2),
      player("c", 1),
      player("d", 0, { rating: 800, hadBye: true }),
      player("e", 0, { rating: 900 }),
    ];
    const { bye } = generatePairings(players);
    expect(bye).toBe("e");
  });

  it("walks up to a higher score group rather than give a second bye", () => {
    // Todo el grupo de 0 ya tuvo bye, así que le toca al más bajo del grupo
    // que sigue, no a un repetido.
    const players = [
      player("a", 1, { rating: 2000 }),
      player("b", 1, { rating: 1900 }),
      player("mid", 1, { rating: 1100 }),
      player("z1", 0, { rating: 900, hadBye: true }),
      player("z2", 0, { rating: 800, hadBye: true }),
    ];
    const { bye } = generatePairings(players);
    expect(bye).toBe("mid");
  });

  it("only repeats a bye when every active player has already had one", () => {
    const players = [
      player("a", 1, { rating: 2000, hadBye: true }),
      player("b", 1, { rating: 1900, hadBye: true }),
      player("c", 0, { rating: 800, hadBye: true }),
    ];
    const { bye, pairs } = generatePairings(players);
    expect(bye).toBe("c");
    expect(pairs).toHaveLength(1);
  });

  it("gives the bye to the only player left in a field of one", () => {
    expect(generatePairings([player("solo", 0)])).toEqual({ pairs: [], bye: "solo" });
  });

  it("returns nothing for an empty field", () => {
    expect(generatePairings([])).toEqual({ pairs: [], bye: null });
  });
});

function seed(id: string, lastName: string, rating: number | null, firstName = ""): SeedPlayer {
  return { id, lastName, firstName, rating };
}

describe("generateInitialPairings", () => {
  it("splits an 8-player field in half by rating and pairs top vs bottom", () => {
    const players = [
      seed("p1", "A", 2200),
      seed("p2", "B", 2100),
      seed("p3", "C", 2000),
      seed("p4", "D", 1900),
      seed("p5", "E", 1800),
      seed("p6", "F", 1700),
      seed("p7", "G", 1600),
      seed("p8", "H", 1500),
    ];
    const { pairs, bye } = generateInitialPairings(players, { topBoardColor: "white" });
    expect(bye).toBeNull();
    expect(pairs).toEqual([
      { white: "p1", black: "p5" },
      { white: "p6", black: "p2" },
      { white: "p3", black: "p7" },
      { white: "p8", black: "p4" },
    ]);
  });

  it("mirrors every board when the draw gives the top seed black", () => {
    const players = [
      seed("p1", "A", 2200),
      seed("p2", "B", 2100),
      seed("p3", "C", 2000),
      seed("p4", "D", 1900),
    ];
    expect(generateInitialPairings(players, { topBoardColor: "black" }).pairs).toEqual([
      { white: "p3", black: "p1" },
      { white: "p2", black: "p4" },
    ]);
    expect(generateInitialPairings(players, { topBoardColor: "white" }).pairs).toEqual([
      { white: "p1", black: "p3" },
      { white: "p4", black: "p2" },
    ]);
  });

  it("draws the top board's color at random when it is not given", () => {
    const players = [seed("p1", "A", 2200), seed("p2", "B", 2100)];
    const original = Math.random;
    try {
      Math.random = () => 0.1;
      expect(generateInitialPairings(players).pairs).toEqual([{ white: "p1", black: "p2" }]);
      Math.random = () => 0.9;
      expect(generateInitialPairings(players).pairs).toEqual([{ white: "p2", black: "p1" }]);
    } finally {
      Math.random = original;
    }
  });

  it("breaks rating ties alphabetically by surname", () => {
    const players = [
      seed("p1", "Zeta", 1500),
      seed("p2", "Alfa", 1500),
      seed("p3", "Beta", 1500),
      seed("p4", "Gamma", 1500),
    ];
    const { pairs } = generateInitialPairings(players, { topBoardColor: "white" });
    expect(pairs).toEqual([
      { white: "p2", black: "p4" },
      { white: "p1", black: "p3" },
    ]);
  });

  it("sorts by surname even when given names would order differently", () => {
    const players = [
      seed("p1", "Zapata", 1500, "Ana"),
      seed("p2", "Aguirre", 1500, "Beto"),
      seed("p3", "Zapata", 1500, "Beto"),
      seed("p4", "Aguirre", 1500, "Ana"),
    ];
    const { pairs } = generateInitialPairings(players, { topBoardColor: "white" });
    expect(pairs).toEqual([
      { white: "p4", black: "p1" },
      { white: "p3", black: "p2" },
    ]);
  });

  it("breaks a surname tie by given name", () => {
    const players = [seed("p1", "Salazar", 1500, "Diego"), seed("p2", "Salazar", 1500, "Ana")];
    const { pairs } = generateInitialPairings(players, { topBoardColor: "white" });
    expect(pairs).toEqual([{ white: "p2", black: "p1" }]);
  });

  it("seeds unrated players below rated ones", () => {
    const players = [seed("p1", "Unrated A", null), seed("p2", "Rated", 1200), seed("p3", "Unrated B", null)];
    const { pairs, bye } = generateInitialPairings(players, { topBoardColor: "white" });
    expect(bye).toBe("p3");
    expect(pairs).toEqual([{ white: "p2", black: "p1" }]);
  });
});

/**
 * Full-tournament simulation. Deterministic results (a seeded generator, no
 * Math.random) so a failure is always reproducible: the point is to catch a
 * rule break that only shows up several rounds in, once histories are long
 * enough for the constraints to start fighting each other.
 */
describe("generatePairings — torneo completo", () => {
  function lcg(seedValue: number) {
    let state = seedValue;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  interface SimPlayer {
    id: string;
    score: number;
    rating: number;
    colorHistory: Color[];
    opponents: Set<string>;
    hadBye: boolean;
    downfloatedLastRound: boolean;
  }

  function runTournament(playerCount: number, rounds: number, seedValue: number) {
    const random = lcg(seedValue);
    const players: SimPlayer[] = Array.from({ length: playerCount }, (_, i) => ({
      id: `p${i + 1}`,
      score: 0,
      rating: 2200 - i * 50,
      colorHistory: [],
      opponents: new Set<string>(),
      hadBye: false,
      downfloatedLastRound: false,
    }));
    const byId = new Map(players.map((p) => [p.id, p]));
    const byeCounts = new Map<string, number>();
    const rematches: string[] = [];
    const colorBreaks: string[] = [];
    let downfloats = 0;
    let repeatDownfloats = 0;

    for (let round = 0; round < rounds; round++) {
      const { pairs, bye } = generatePairings(
        players.map((p) => ({
          id: p.id,
          lastName: p.id,
          firstName: "",
          score: p.score,
          rating: p.rating,
          colorHistory: p.colorHistory,
          opponents: p.opponents,
          hadBye: p.hadBye,
          hadForfeitWin: false,
          downfloatedLastRound: p.downfloatedLastRound,
        })),
      );

      // Whoever is the higher-scoring half of a mixed-score pair was moved
      // down out of their own group this round.
      const floatedNow = new Set<string>();
      for (const pair of pairs) {
        const white = byId.get(pair.white)!;
        const black = byId.get(pair.black)!;
        if (white.score === black.score) continue;
        const downfloater = white.score > black.score ? white : black;
        floatedNow.add(downfloater.id);
        downfloats++;
        if (downfloater.downfloatedLastRound) {
          repeatDownfloats++;
        }
      }

      const playing = new Set<string>();
      for (const pair of pairs) {
        const white = byId.get(pair.white)!;
        const black = byId.get(pair.black)!;
        if (white.opponents.has(black.id)) rematches.push(`R${round + 1} ${white.id}-${black.id}`);
        playing.add(white.id);
        playing.add(black.id);
        white.opponents.add(black.id);
        black.opponents.add(white.id);
        white.colorHistory.push(W);
        black.colorHistory.push(B);
        const roll = random();
        if (roll < 0.45) white.score += 1;
        else if (roll < 0.9) black.score += 1;
        else {
          white.score += 0.5;
          black.score += 0.5;
        }
      }
      if (bye) {
        const player = byId.get(bye)!;
        byeCounts.set(bye, (byeCounts.get(bye) ?? 0) + 1);
        player.hadBye = true;
        player.score += 1;
        playing.add(bye);
      }
      // Everyone is accounted for every round: paired or on the bye.
      expect(playing.size).toBe(playerCount);

      for (const p of players) p.downfloatedLastRound = floatedNow.has(p.id);

      // The color rules are checked after every round, not just at the end: a
      // player can go out of balance in one round and be brought back by the
      // next, and a final-state check would quietly miss it.
      for (const p of players) {
        if (Math.abs(colorBalance(p.colorHistory)) > MAX_COLOR_DIFFERENCE) {
          colorBreaks.push(`R${round + 1} ${p.id} balance=${colorBalance(p.colorHistory)}`);
        }
        if (trailingStreak(p.colorHistory).length > 2) {
          colorBreaks.push(`R${round + 1} ${p.id} streak=${trailingStreak(p.colorHistory).length}`);
        }
      }
    }

    return { players, byeCounts, rematches, colorBreaks, downfloats, repeatDownfloats };
  }

  it("plays 7 rounds with 16 players breaking no rule at any point", () => {
    const { players, byeCounts, rematches, colorBreaks } = runTournament(16, 7, 20260908);
    expect(rematches).toEqual([]);
    expect(colorBreaks).toEqual([]);
    expect([...byeCounts.values()]).toEqual([]);
    for (const p of players) expect(p.colorHistory).toHaveLength(7);
  });

  it("plays 7 rounds with an odd field without repeating a pairing or a bye", () => {
    const { byeCounts, rematches, colorBreaks } = runTournament(11, 7, 4242);
    expect(rematches).toEqual([]);
    expect(colorBreaks).toEqual([]);
    // 7 rounds, 7 byes, all to different players.
    expect(byeCounts.size).toBe(7);
    for (const count of byeCounts.values()) expect(count).toBe(1);
  });

  it("pairs a 40-player round quickly enough for a live tournament", () => {
    // Regresión de rendimiento: una versión anterior del retroceso entre
    // grupos se disparaba en exponencial y una ronda de 31 jugadores llegó a
    // tardar ~5 s. El margen es amplio a propósito para no depender de la
    // máquina, pero deja fuera cualquier vuelta a ese orden de magnitud.
    const started = Date.now();
    runTournament(40, 6, 99);
    expect(Date.now() - started).toBeLessThan(6000);
  });
});

describe("generatePairings — posiciones apretadas", () => {
  it("pairs the position that the stricter +/-1 rule made impossible", () => {
    // Posición real encontrada simulando torneos de 8 jugadores. Con el límite
    // de color en +/-1 no tenía solución: de los 105 emparejamientos posibles
    // solo 14 evitan la revancha, y ninguno de esos 14 respetaba el +/-1, así
    // que había que romper el color de dos jugadores. Con el límite de FIDE
    // (+/-2, C.04.1.f) los 14 son legales y la ronda sale limpia.
    const players = [
      player("p1", 0, { rating: 2200, colorHistory: [W, B, W], opponents: new Set(["p5", "p7", "p6"]) }),
      player("p2", 2, { rating: 2163, colorHistory: [W, B, W], opponents: new Set(["p6", "p5", "p3"]) }),
      player("p3", 1, { rating: 2126, colorHistory: [W, B, B], opponents: new Set(["p7", "p8", "p2"]) }),
      player("p4", 2, { rating: 2089, colorHistory: [W, B, W], opponents: new Set(["p8", "p6", "p5"]) }),
      player("p5", 3, { rating: 2052, colorHistory: [B, W, B], opponents: new Set(["p1", "p2", "p4"]) }),
      player("p6", 1, { rating: 2015, colorHistory: [B, W, B], opponents: new Set(["p2", "p4", "p1"]) }),
      player("p7", 1, { rating: 1978, colorHistory: [B, W, B], opponents: new Set(["p3", "p1", "p8"]) }),
      player("p8", 2, { rating: 1941, colorHistory: [B, W, W], opponents: new Set(["p4", "p3", "p7"]) }),
    ];
    const byId = new Map(players.map((p) => [p.id, p]));
    const { pairs, bye } = generatePairings(players);

    expect(bye).toBeNull();
    expect(pairs).toHaveLength(4);
    for (const pair of pairs) {
      expect(byId.get(pair.white)!.opponents.has(pair.black)).toBe(false);
    }

    let outOfBalance = 0;
    let tripleColor = 0;
    for (const pair of pairs) {
      for (const [id, color] of [[pair.white, W] as const, [pair.black, B] as const]) {
        const history = [...byId.get(id)!.colorHistory, color];
        if (Math.abs(colorBalance(history)) > MAX_COLOR_DIFFERENCE) outOfBalance++;
        if (trailingStreak(history).length > 2) tripleColor++;
      }
    }
    expect(outOfBalance).toBe(0);
    expect(tripleColor).toBe(0);
  });
});

describe("generatePairings — cercanía de puntaje", () => {
  /** Grupos de puntaje presentes, de mayor a menor. */
  const bracketsOf = (field: PairingPlayer[]) =>
    [...new Set(field.map((p) => p.score))].sort((a, b) => b - a);

  /** Cuántos grupos separan a los dos jugadores de cada mesa, como máximo. */
  function widestSpan(field: PairingPlayer[], pairs: PairingPair[], byeId: string | null) {
    const playing = field.filter((p) => p.id !== byeId);
    const index = new Map(bracketsOf(playing).map((score, i) => [score, i]));
    const scoreOf = new Map(field.map((p) => [p.id, p.score]));
    let widest = 0;
    for (const pair of pairs) {
      widest = Math.max(
        widest,
        Math.abs(index.get(scoreOf.get(pair.white)!)! - index.get(scoreOf.get(pair.black)!)!),
      );
    }
    return widest;
  }

  /**
   * Oráculo independiente: arma el grafo a mano y le pide a Blossom un
   * emparejamiento de cardinalidad máxima. Si no es perfecto, con ese ancho no
   * existe ninguna ronda posible — así se distingue un salto obligado de uno
   * elegido, sin reusar la búsqueda del motor.
   */
  function pairableWithin(field: PairingPlayer[], span: number): boolean {
    if (field.length % 2 === 1) return false;
    const index = new Map(bracketsOf(field).map((score, i) => [score, i]));
    const edges: Array<[number, number, number]> = [];
    for (let i = 0; i < field.length; i++) {
      for (let j = i + 1; j < field.length; j++) {
        if (field[i].opponents.has(field[j].id)) continue;
        if (Math.abs(index.get(field[i].score)! - index.get(field[j].score)!) > span) continue;
        // Colors are absolute, so a pair the color rules forbid is not an
        // option the engine could have taken either.
        if (!colorsCompatible(field[i], field[j])) continue;
        edges.push([i, j, 1]);
      }
    }
    if (edges.length === 0) return false;
    return maxWeightMatching(field.length, edges, true).every((mate) => mate >= 0);
  }

  it("keeps every board inside one score group when the field allows it", () => {
    // La forma del torneo real que falló: 3 jugadores en 2 puntos, 5 en 1,
    // 2 en 0.5 y 1 en 0. Producción emparejó a uno de 2 contra uno de 0.5,
    // saltándose el grupo de 1 entero.
    const field = [
      player("a2100", 2, { rating: 2100 }),
      player("a2000", 2, { rating: 2000 }),
      player("a1900", 2, { rating: 1900 }),
      player("b1500", 1, { rating: 1500 }),
      player("b1300", 1, { rating: 1300 }),
      player("b1200", 1, { rating: 1200 }),
      player("b1100", 1, { rating: 1100 }),
      player("b1000", 1, { rating: 1000 }),
      player("c900", 0.5, { rating: 900 }),
      player("c800", 0.5, { rating: 800 }),
      player("d700", 0, { rating: 700 }),
    ];
    const { pairs, bye } = generatePairings(field);
    expect(widestSpan(field, pairs, bye)).toBe(1);
    // Y en particular, nadie de 2 puntos se cruza con nadie de 0.5.
    for (const pair of pairs) {
      const scores = [field.find((p) => p.id === pair.white)!.score, field.find((p) => p.id === pair.black)!.score];
      expect(Math.abs(scores[0] - scores[1])).toBeLessThanOrEqual(1);
    }
  });

  it("widens the gap only when the closer pairing is genuinely impossible", () => {
    // "top" ya jugó contra el único rival de su grupo vecino, así que bajar un
    // solo grupo no alcanza y el salto de dos es obligado, no elegido.
    const field = [
      player("top", 2, { rating: 2000, opponents: new Set(["next"]) }),
      player("next", 1.5, { rating: 1900, opponents: new Set(["top"]) }),
      player("low1", 1, { rating: 1800 }),
      player("low2", 1, { rating: 1700 }),
    ];
    const { pairs, bye } = generatePairings(field);
    expect(pairableWithin(field, 1)).toBe(false);
    expect(widestSpan(field, pairs, bye)).toBe(2);
  });

  it("never uses a wider gap than the field forces, across whole tournaments", () => {
    // Propiedad, no ejemplo: ronda por ronda se compara el ancho realmente
    // usado contra el mínimo que el oráculo dice que era posible.
    const random = (seedValue: number) => {
      let state = seedValue;
      return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
    };

    for (const [count, seedValue] of [[11, 7], [12, 99], [16, 4242]] as Array<[number, number]>) {
      const roll = random(seedValue);
      const live = Array.from({ length: count }, (_, i) => ({
        id: `p${i + 1}`,
        rating: 2200 - i * 37,
        score: 0,
        colorHistory: [] as Color[],
        opponents: new Set<string>(),
        hadBye: false,
        downfloatedLastRound: false,
      }));
      const byId = new Map(live.map((p) => [p.id, p]));

      for (let round = 1; round <= 6; round++) {
        const field: PairingPlayer[] = live.map((p) => ({
          id: p.id,
          lastName: p.id,
          firstName: "",
          score: p.score,
          rating: p.rating,
          colorHistory: p.colorHistory,
          opponents: p.opponents,
          hadBye: p.hadBye,
          hadForfeitWin: false,
          downfloatedLastRound: p.downfloatedLastRound,
        }));
        const { pairs, bye } = generatePairings(field);
        const playing = field.filter((p) => p.id !== bye);

        let minimum = 1;
        while (minimum < 10 && !pairableWithin(playing, minimum)) minimum++;
        expect(
          widestSpan(field, pairs, bye),
          `${count} jugadores, ronda ${round}`,
        ).toBeLessThanOrEqual(minimum);

        const floated = new Set<string>();
        for (const pair of pairs) {
          const white = byId.get(pair.white)!;
          const black = byId.get(pair.black)!;
          if (white.score !== black.score) {
            floated.add(white.score > black.score ? white.id : black.id);
          }
          white.opponents.add(black.id);
          black.opponents.add(white.id);
          white.colorHistory.push(W);
          black.colorHistory.push(B);
          const outcome = roll();
          if (outcome < 0.45) white.score += 1;
          else if (outcome < 0.9) black.score += 1;
          else {
            white.score += 0.5;
            black.score += 0.5;
          }
        }
        if (bye) {
          const player = byId.get(bye)!;
          player.hadBye = true;
          player.score += 1;
        }
        for (const p of live) p.downfloatedLastRound = floated.has(p.id);
      }
    }
  });
});

describe("generatePairings — orden de mesas por grupo", () => {
  it("puts a full 1-1 board above a 1-0.5 float board", () => {
    // Regresión de un torneo real: la mesa 4 tenía 1 vs 0.5 y la mesa 5, 1 vs 1.
    // Acá el que baja es el de mayor Elo del grupo (los otros dos ya jugaron
    // contra el único rival de abajo), así que ordenar por el mejor jugador de
    // cada mesa ponía la mesa del flotante primero.
    const field = [
      player("top", 1, { rating: 2000 }),
      player("mid", 1, { rating: 1500, opponents: new Set(["low"]) }),
      player("bottom", 1, { rating: 1400, opponents: new Set(["low"]) }),
      player("low", 0.5, { rating: 900, opponents: new Set(["mid", "bottom"]) }),
    ];
    const { pairs } = generatePairings(field);
    expect(paired(pairs, "top", "low")).toBe(true);
    expect(paired(pairs, "mid", "bottom")).toBe(true);
    // El grupo manda sobre el Elo: 1-1 antes que 1-0.5.
    expect([pairs[0].white, pairs[0].black].sort()).toEqual(["bottom", "mid"]);
    expect([pairs[1].white, pairs[1].black].sort()).toEqual(["low", "top"]);
  });

  it("orders boards by the higher score first and the lower score next", () => {
    const field = [
      player("x2", 2, { rating: 1000 }),
      player("y2", 2, { rating: 900 }),
      player("x1", 1, { rating: 2500 }),
      player("y1", 1, { rating: 2400 }),
      player("x0", 0, { rating: 2300 }),
      player("y0", 0, { rating: 2200 }),
    ];
    const { pairs } = generatePairings(field);
    expect([pairs[0].white, pairs[0].black].sort()).toEqual(["x2", "y2"]);
    expect([pairs[1].white, pairs[1].black].sort()).toEqual(["x1", "y1"]);
    expect([pairs[2].white, pairs[2].black].sort()).toEqual(["x0", "y0"]);
  });
});

describe("generatePairings — orden explicable (FIDE C.04.1.i)", () => {
  it("separates equally-rated players by surname, never by the internal id", () => {
    // Mismo puntaje y mismo Elo: la clasificación es alfabética, así que
    // Alvarez va por delante de Zapata y el bye le toca a Zapata, el último
    // de la lista. Los ids van al revés que los apellidos a propósito: si el
    // desempate siguiera mirando el id, el bye caería en Alvarez.
    const players = [
      player("p1", 1, { rating: 2000, lastName: "Uno" }),
      player("p2", 1, { rating: 1900, lastName: "Dos" }),
      player("p3", 1, { rating: 1800, lastName: "Tres" }),
      player("zzz", 0, { rating: 1200, lastName: "Alvarez" }),
      player("aaa", 0, { rating: 1200, lastName: "Zapata" }),
    ];
    expect(generatePairings(players).bye).toBe("aaa");
  });

  it("uses the given name when the surname is also shared", () => {
    const players = [
      player("p1", 1, { rating: 2000, lastName: "Uno" }),
      player("p2", 1, { rating: 1900, lastName: "Dos" }),
      player("p3", 1, { rating: 1800, lastName: "Tres" }),
      player("zzz", 0, { rating: 1200, lastName: "Salazar", firstName: "Ana" }),
      player("aaa", 0, { rating: 1200, lastName: "Salazar", firstName: "Diego" }),
    ];
    // Diego va después de Ana, así que el bye es de Diego — id "aaa", el que
    // un desempate por id nunca habría elegido.
    expect(generatePairings(players).bye).toBe("aaa");
  });

  it("ranks boards by surname when two players share a rating", () => {
    // El plegado ordena el grupo por Elo y, a igual Elo, alfabéticamente:
    // Alvarez es cabeza de serie y juega la mesa 1.
    const players = [
      player("zzz", 1, { rating: 2000, lastName: "Alvarez" }),
      player("aaa", 1, { rating: 2000, lastName: "Zapata" }),
      player("c", 1, { rating: 1000, lastName: "Castro" }),
      player("d", 1, { rating: 900, lastName: "Diaz" }),
    ];
    const { pairs } = generatePairings(players);
    expect([pairs[0].white, pairs[0].black]).toContain("zzz");
  });
});

describe("generatePairings — flotantes repetidos", () => {
  const group = (extra: Partial<PairingPlayer> = {}) => [
    player("top", 1, { rating: 2000 }),
    player("mid", 1, { rating: 1500 }),
    player("justFloated", 1, { rating: 1000, ...extra }),
    player("low1", 0, { rating: 900 }),
    player("low2", 0, { rating: 800 }),
    player("low3", 0, { rating: 700 }),
  ];

  it("floats the lowest-rated player when nobody floated last round", () => {
    const { pairs } = generatePairings(group());
    expect(opponentOf(pairs, "justFloated")).toBe("low1");
    expect(opponentOf(pairs, "top")).toBe("mid");
  });

  it("floats somebody else when the usual choice already floated last round", () => {
    // FIDE pide no hacer bajar de grupo al mismo jugador dos rondas seguidas,
    // aunque sea el de menor Elo del grupo impar.
    const { pairs } = generatePairings(group({ downfloatedLastRound: true }));
    expect(opponentOf(pairs, "justFloated")).toBe("top");
    expect(opponentOf(pairs, "mid")).toBe("low1");
  });

  it("still floats a repeat floater when there is no other way to pair", () => {
    // "mid" y "top" ya jugaron contra todos los del grupo de abajo, así que
    // el único flotante posible sigue siendo el que ya bajó la ronda pasada.
    const players = [
      player("top", 1, { rating: 2000, opponents: new Set(["low1", "low2", "low3"]) }),
      player("mid", 1, { rating: 1500, opponents: new Set(["low1", "low2", "low3"]) }),
      player("justFloated", 1, { rating: 1000, downfloatedLastRound: true }),
      player("low1", 0, { rating: 900, opponents: new Set(["top", "mid"]) }),
      player("low2", 0, { rating: 800, opponents: new Set(["top", "mid"]) }),
      player("low3", 0, { rating: 700, opponents: new Set(["top", "mid"]) }),
    ];
    const { pairs } = generatePairings(players);
    expect(opponentOf(pairs, "top")).toBe("mid");
    expect(opponentOf(pairs, "justFloated")).toBe("low1");
  });
});

describe("generatePairings — el bye se decide primero y manda", () => {
  const scoreOf = (field: PairingPlayer[], id: string) => field.find((p) => p.id === id)!.score;

  it("gives the bye to the bottom player even when the top group cannot pair itself", () => {
    // Los dos punteros ya se enfrentaron, así que su grupo no se puede armar y
    // alguien tiene que bajar. Sacar del medio a "mid" dejaría el resto más
    // cómodo, y eso es justo lo que el motor hacía: usaba el bye para
    // destrabar los primeros tableros. El bye es del último, y los punteros
    // flotan.
    const field = [
      player("topA", 2, { rating: 2000, opponents: new Set(["topB"]) }),
      player("topB", 2, { rating: 1900, opponents: new Set(["topA"]) }),
      player("mid", 1, { rating: 1500 }),
      player("lowHigher", 0, { rating: 1000 }),
      player("lowLowest", 0, { rating: 900 }),
    ];
    const { pairs, bye } = generatePairings(field);

    expect(bye).toBe("lowLowest");
    // Y nadie del grupo puntero se queda sin jugar.
    for (const id of ["topA", "topB"]) {
      expect(opponentOf(pairs, id)).not.toBeNull();
    }
    // Los punteros bajaron de grupo en vez de recibir el bye.
    expect(scoreOf(field, opponentOf(pairs, "topA")!)).toBeLessThan(2);
    expect(scoreOf(field, opponentOf(pairs, "topB")!)).toBeLessThan(2);
  });

  it("gives the bye to the bottom player when the top group has a color clash", () => {
    // Los dos punteros vienen de dos blancas seguidas: los dos deben negras de
    // forma absoluta, así que no se pueden emparejar entre ellos. Igual que
    // arriba, la salida es que floten, no que uno se lleve un punto gratis.
    const field = [
      player("topA", 2, { rating: 2000, colorHistory: [W, W] }),
      player("topB", 2, { rating: 1900, colorHistory: [W, W] }),
      player("mid", 1, { rating: 1500, colorHistory: [B, W] }),
      player("lowHigher", 0, { rating: 1000, colorHistory: [B, B] }),
      player("lowLowest", 0, { rating: 900, colorHistory: [W, B] }),
    ];
    const { pairs, bye } = generatePairings(field);

    expect(bye).toBe("lowLowest");
    expect(opponentOf(pairs, "topA")).not.toBeNull();
    expect(opponentOf(pairs, "topB")).not.toBeNull();
    // Y no se emparejaron entre ellos, que era lo imposible.
    expect(paired(pairs, "topA", "topB")).toBe(false);
  });

  it("never hands the bye to anyone in the leading score group", () => {
    // Propiedad sobre torneos enteros: el bye jamás puede caer en el grupo de
    // arriba, pase lo que pase con los emparejamientos.
    const roll = (() => {
      let state = 31337;
      return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
    })();

    for (const count of [9, 11, 13, 15]) {
      const live = Array.from({ length: count }, (_, i) => ({
        id: `p${i + 1}`,
        rating: 2200 - i * 37,
        score: 0,
        colorHistory: [] as Color[],
        opponents: new Set<string>(),
        hadBye: false,
        downfloatedLastRound: false,
      }));
      const byId = new Map(live.map((p) => [p.id, p]));

      for (let round = 1; round <= 7; round++) {
        const field: PairingPlayer[] = live.map((p) => ({
          id: p.id,
          lastName: p.id,
          firstName: "",
          score: p.score,
          rating: p.rating,
          colorHistory: p.colorHistory,
          opponents: p.opponents,
          hadBye: p.hadBye,
          hadForfeitWin: false,
          downfloatedLastRound: p.downfloatedLastRound,
        }));
        const { pairs, bye } = generatePairings(field);
        expect(bye).not.toBeNull();

        const topScore = Math.max(...field.map((p) => p.score));
        const byeScore = field.find((p) => p.id === bye)!.score;
        // En la ronda 1 todos están en cero: hay un solo grupo y el bye sale de
        // ahí por fuerza. En cuanto hay más de un grupo, jamás puede salir del
        // de arriba.
        const groups = new Set(field.map((p) => p.score)).size;
        if (groups > 1) {
          expect(
            byeScore,
            `${count} jugadores, ronda ${round}: bye con ${byeScore} y el puntero tiene ${topScore}`,
          ).toBeLessThan(topScore);
        }

        // Y además es el más bajo de los que todavía podían recibirlo.
        const eligible = field.filter((p) => !p.hadBye);
        const lowest = Math.min(...eligible.map((p) => p.score));
        expect(byeScore).toBe(lowest);

        const floated = new Set<string>();
        for (const pair of pairs) {
          const white = byId.get(pair.white)!;
          const black = byId.get(pair.black)!;
          if (white.score !== black.score) {
            floated.add(white.score > black.score ? white.id : black.id);
          }
          white.opponents.add(black.id);
          black.opponents.add(white.id);
          white.colorHistory.push(W);
          black.colorHistory.push(B);
          const outcome = roll();
          if (outcome < 0.45) white.score += 1;
          else if (outcome < 0.9) black.score += 1;
          else {
            white.score += 0.5;
            black.score += 0.5;
          }
        }
        const rested = byId.get(bye!)!;
        rested.hadBye = true;
        rested.score += 1;
        for (const p of live) p.downfloatedLastRound = floated.has(p.id);
      }
    }
  });
});

describe("generatePairings — bye y walkover (FIDE C.04.1.d)", () => {
  it("does not give the bye to a player who already won by forfeit", () => {
    // Un W.O. ya le dio un punto sin jugar; el bye le daría un segundo.
    const players = [
      player("a", 1, { rating: 2000 }),
      player("b", 1, { rating: 1900 }),
      player("c", 1, { rating: 1800 }),
      player("walkover", 0, { rating: 800, hadForfeitWin: true }),
      player("next", 0, { rating: 900 }),
    ];
    expect(generatePairings(players).bye).toBe("next");
  });

  it("skips both a previous bye and a previous forfeit win", () => {
    const players = [
      player("a", 1, { rating: 2000 }),
      player("b", 1, { rating: 1900 }),
      player("c", 1, { rating: 1500 }),
      player("hadBye", 0, { rating: 700, hadBye: true }),
      player("walkover", 0, { rating: 800, hadForfeitWin: true }),
    ];
    // Los dos del grupo de 0 están vetados, así que sube al grupo de 1.
    expect(generatePairings(players).bye).toBe("c");
  });

  it("still gives the bye when every remaining player is ineligible", () => {
    const players = [
      player("a", 1, { rating: 2000, hadForfeitWin: true }),
      player("b", 1, { rating: 1900, hadBye: true }),
      player("c", 0, { rating: 800, hadForfeitWin: true }),
    ];
    const { bye, pairs } = generatePairings(players);
    expect(bye).toBe("c");
    expect(pairs).toHaveLength(1);
  });
});
