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
