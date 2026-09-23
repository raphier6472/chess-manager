import { describe, expect, it } from "vitest";
import { computeStandings, type MatchOutcome } from "./tiebreaks";

describe("computeStandings", () => {
  it("computes score, Buchholz and Sonneborn-Berger by hand-checked example", () => {
    // Round 1: A beats B, C beats D. Round 2: A beats C, B beats D.
    const players = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
      { id: "D", name: "D" },
    ];
    const history = new Map<string, MatchOutcome[]>([
      [
        "A",
        [
          { opponentId: "B", result: "win" },
          { opponentId: "C", result: "win" },
        ],
      ],
      [
        "B",
        [
          { opponentId: "A", result: "loss" },
          { opponentId: "D", result: "win" },
        ],
      ],
      [
        "C",
        [
          { opponentId: "D", result: "win" },
          { opponentId: "A", result: "loss" },
        ],
      ],
      [
        "D",
        [
          { opponentId: "C", result: "loss" },
          { opponentId: "B", result: "loss" },
        ],
      ],
    ]);

    const rows = computeStandings(players, history);
    const byId = new Map(rows.map((r) => [r.playerId, r]));

    expect(byId.get("A")).toMatchObject({ score: 2, buchholz: 2, sonnebornBerger: 2 });
    expect(byId.get("B")).toMatchObject({ score: 1, buchholz: 2, sonnebornBerger: 0 });
    expect(byId.get("C")).toMatchObject({ score: 1, buchholz: 2, sonnebornBerger: 0 });
    expect(byId.get("D")).toMatchObject({ score: 0, buchholz: 2, sonnebornBerger: 0 });

    // Sorted by score desc, then Buchholz, then SB.
    expect(rows[0].playerId).toBe("A");
  });

  it("gives a bye 1 point and no tiebreak contribution", () => {
    const players = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
    ];
    const history = new Map<string, MatchOutcome[]>([
      ["A", [{ opponentId: null, result: "bye" }]],
      ["B", [{ opponentId: "A", result: "loss" }]],
    ]);
    const rows = computeStandings(players, history);
    const a = rows.find((r) => r.playerId === "A")!;
    expect(a.score).toBe(1);
    expect(a.buchholz).toBe(0);
    expect(a.sonnebornBerger).toBe(0);
  });

  it("splits Sonneborn-Berger credit in half for a draw", () => {
    const players = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
    ];
    const history = new Map<string, MatchOutcome[]>([
      ["A", [{ opponentId: "B", result: "draw" }]],
      ["B", [{ opponentId: "A", result: "draw" }]],
      ["C", [{ opponentId: null, result: "bye" }]],
    ]);
    const rows = computeStandings(players, history);
    const a = rows.find((r) => r.playerId === "A")!;
    // B's score is 0.5, A drew with B => SB = 0.5 * 0.5 = 0.25
    expect(a.sonnebornBerger).toBe(0.25);
  });
});

/**
 * History from a list of games ("A>B" = A beat B, "A=B" = draw) plus rows without an
 * opponent ("A:bye", "A:half-bye", "A:zero-bye"). Every scenario below is built so that
 * Buchholz alone would give a *different* order than the one asserted, so a test only
 * passes if Direct Encounter is doing the ranking — or, for the strict-condition cases,
 * only if it is correctly left out.
 */
function tournament(ids: string[], games: string[]) {
  const history = new Map<string, MatchOutcome[]>(ids.map((id) => [id, []]));
  for (const g of games) {
    const bye = g.match(/^(\w+):(bye|half-bye|zero-bye)$/);
    if (bye) {
      history.get(bye[1])!.push({ opponentId: null, result: bye[2] as MatchOutcome["result"] });
      continue;
    }
    const [, a, op, b] = g.match(/^(\w+)([>=])(\w+)$/)!;
    history.get(a)!.push({ opponentId: b, result: op === ">" ? "win" : "draw" });
    history.get(b)!.push({ opponentId: a, result: op === ">" ? "loss" : "draw" });
  }
  const rows = computeStandings(
    ids.map((id) => ({ id, name: id })),
    history,
  );
  return { rows, order: rows.map((r) => r.playerId), byId: new Map(rows.map((r) => [r.playerId, r])) };
}

describe("Direct Encounter", () => {
  describe("two-way tie", () => {
    // X and Y end on 1 point each. Y has the stronger Buchholz (Z has 3, W has 2), so
    // without Direct Encounter Y would be ahead.
    it("puts the winner of their game first, over a better Buchholz", () => {
      const { order, byId } = tournament(
        ["X", "Y", "W", "Z"],
        ["X>Y", "W>X", "Y>Z", "W:bye", "Z:bye", "Z:bye", "Z:bye"],
      );
      expect(byId.get("X")).toMatchObject({ score: 1, buchholz: 3, directEncounter: 1 });
      expect(byId.get("Y")).toMatchObject({ score: 1, buchholz: 4, directEncounter: 0 });
      expect(order.indexOf("X")).toBeLessThan(order.indexOf("Y"));
    });

    it("a draw between them leaves the tie for the next tiebreak (Buchholz)", () => {
      // X and Y drew and both end on 1.5; each gets ½ from Direct Encounter, so it
      // separates nothing and Buchholz (X: 1.5 + 2, Y: 1.5 + 3) puts Y first.
      const { order, byId } = tournament(
        ["X", "Y", "W", "Z"],
        ["X=Y", "X>W", "Y>Z", "W:bye", "W:bye", "Z:bye", "Z:bye", "Z:bye"],
      );
      expect(byId.get("X")).toMatchObject({ score: 1.5, buchholz: 3.5, directEncounter: 0.5 });
      expect(byId.get("Y")).toMatchObject({ score: 1.5, buchholz: 4.5, directEncounter: 0.5 });
      expect(order.indexOf("Y")).toBeLessThan(order.indexOf("X"));
    });

    it("if they never played each other, the rule does not apply", () => {
      const { byId } = tournament(["X", "Y", "Z", "W"], ["X>Z", "Y>W"]);
      expect(byId.get("X")!.directEncounter).toBeNull();
      expect(byId.get("Y")!.directEncounter).toBeNull();
    });
  });

  describe("multi-way tie", () => {
    // A, B and C all finish on 2.5. Among themselves: A beat B, A drew C, B beat C,
    // so the sub-scores are A 1½, B 1, C ½. Outside the group A only beat F (0 points)
    // while B and C played D and E, so A has the *lowest* Buchholz of the three (5
    // against 5.5): ranked by Buchholz, A would be third.
    const group = ["A>B", "A=C", "B>C", "A>F", "B>D", "B=E", "C>D", "C>E"];

    it("sorts the tied group by points scored among themselves when all met", () => {
      const { order, byId } = tournament(["A", "B", "C", "D", "E", "F"], group);
      expect(byId.get("A")).toMatchObject({ score: 2.5, buchholz: 5, directEncounter: 1.5 });
      expect(byId.get("B")).toMatchObject({ score: 2.5, buchholz: 5.5, directEncounter: 1 });
      expect(byId.get("C")).toMatchObject({ score: 2.5, buchholz: 5.5, directEncounter: 0.5 });
      expect(order.slice(0, 3)).toEqual(["A", "B", "C"]);
    });

    it("skips the whole group when a single game among them is missing", () => {
      // Same event, but A and C never met: each drew someone else instead (G, H), so
      // every total is unchanged. A beat B and B beat C still happened — a partial
      // head-to-head would put A ahead of C — but the rule must not apply at all.
      const { order, byId } = tournament(
        ["A", "B", "C", "D", "E", "F", "G", "H"],
        ["A>B", "A=G", "B>C", "A>F", "B>D", "B=E", "C=H", "C>D", "C>E"],
      );
      for (const id of ["A", "B", "C"]) {
        expect(byId.get(id)).toMatchObject({ score: 2.5, directEncounter: null });
      }
      // Buchholz decides instead: B 5.5, C 3.5, A 3.
      expect(order.slice(0, 3)).toEqual(["B", "C", "A"]);
    });

    it("skips a four-way tie where five of the six games were played", () => {
      // A–D is the only pairing that never happened. Everyone ends on 2 (byes pad the
      // totals). Played-games-only sub-scores would be A 2, B 2, C 1, D 0 and put A
      // second; with the rule skipped Buchholz and then Sonneborn-Berger give B, C, A, D.
      const { order, byId } = tournament(
        ["A", "B", "C", "D"],
        ["A>B", "A>C", "B>C", "B>D", "C>D", "C:bye", "D:bye", "D:bye"],
      );
      for (const id of ["A", "B", "C", "D"]) {
        expect(byId.get(id)).toMatchObject({ score: 2, directEncounter: null });
      }
      expect(order).toEqual(["B", "C", "A", "D"]);
    });

    it("decides each score group on its own", () => {
      // The 2.5 group is a full round-robin (applies); the 0 group D/F never met (skips).
      const { byId } = tournament(["A", "B", "C", "D", "E", "F"], group);
      expect(byId.get("D")).toMatchObject({ score: 0, directEncounter: null });
      expect(byId.get("F")).toMatchObject({ score: 0, directEncounter: null });
      expect(byId.get("A")!.directEncounter).toBe(1.5);
    });
  });

  it("a player tied with nobody gets no Direct Encounter value", () => {
    const { byId } = tournament(["A", "B"], ["A>B"]);
    expect(byId.get("A")!.directEncounter).toBeNull();
    expect(byId.get("B")!.directEncounter).toBeNull();
  });
});

describe("late-entry byes", () => {
  it("count ½ and 0 points and add nothing to Buchholz or Sonneborn-Berger", () => {
    const { byId } = tournament(["L", "M"], ["L:zero-bye", "L:half-bye", "L>M"]);
    expect(byId.get("L")).toMatchObject({ score: 1.5, buchholz: 0, sonnebornBerger: 0 });
    expect(byId.get("M")).toMatchObject({ score: 0, buchholz: 1.5 });
  });
});
