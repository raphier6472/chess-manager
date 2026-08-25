import { describe, expect, it } from "vitest";
import { maxWeightMatching } from "./blossom";

describe("maxWeightMatching", () => {
  it("matches the networkx docstring example", () => {
    // nx example (1-indexed): edges (1,2,6)(1,3,2)(2,3,1)(2,4,7)(3,5,9)(4,5,3)
    // expected matching: {(2,4),(5,3)}. Shifted to 0-indexed vertices 0..4.
    const edges: Array<[number, number, number]> = [
      [0, 1, 6],
      [0, 2, 2],
      [1, 2, 1],
      [1, 3, 7],
      [2, 4, 9],
      [3, 4, 3],
    ];
    const mate = maxWeightMatching(5, edges);
    expect(mate[1]).toBe(3);
    expect(mate[3]).toBe(1);
    expect(mate[2]).toBe(4);
    expect(mate[4]).toBe(2);
    expect(mate[0]).toBe(-1);
  });

  it("finds a perfect matching on a simple 4-cycle preferring the heavier pair of edges", () => {
    // Square 0-1-2-3-0. Opposite edges (0,1) and (2,3) are heavy.
    const edges: Array<[number, number, number]> = [
      [0, 1, 5],
      [1, 2, 1],
      [2, 3, 5],
      [3, 0, 1],
    ];
    const mate = maxWeightMatching(4, edges, true);
    expect(mate[0]).toBe(1);
    expect(mate[1]).toBe(0);
    expect(mate[2]).toBe(3);
    expect(mate[3]).toBe(2);
  });

  it("handles an odd number of vertices, leaving one unmatched", () => {
    // Triangle 0-1-2, all equal weight: exactly one vertex stays unmatched.
    const edges: Array<[number, number, number]> = [
      [0, 1, 1],
      [1, 2, 1],
      [2, 0, 1],
    ];
    const mate = maxWeightMatching(3, edges, true);
    const matchedCount = mate.filter((m) => m !== -1).length;
    expect(matchedCount).toBe(2);
    for (let v = 0; v < 3; v++) {
      if (mate[v] !== -1) {
        expect(mate[mate[v]]).toBe(v);
      }
    }
  });

  it("requires blossom handling: odd cycle forcing a non-bipartite augmenting path", () => {
    // Classic blossom stress case (5-cycle plus a pendant), from the
    // networkx test suite: vertices 0..5, triangle-ish structure forces
    // the algorithm to shrink a blossom to find the true maximum matching.
    const edges: Array<[number, number, number]> = [
      [0, 1, 1],
      [1, 2, 1],
      [2, 3, 1],
      [3, 4, 1],
      [4, 0, 1],
      [0, 5, 1],
    ];
    // Max matching should have 3 edges (out of 6 vertices, all matched).
    const mate = maxWeightMatching(6, edges, true);
    const matchedCount = mate.filter((m) => m !== -1).length;
    expect(matchedCount).toBe(6);
    for (let v = 0; v < 6; v++) {
      expect(mate[mate[v]]).toBe(v);
    }
  });
});
