/**
 * Maximum weight matching in a general graph (Edmonds' Blossom algorithm,
 * primal-dual method).
 *
 * Derived from NetworkX's `max_weight_matching` (networkx/algorithms/matching.py).
 * Copyright (c) NetworkX Developers. Licensed under BSD-3-Clause; see
 * https://github.com/networkx/networkx/blob/main/LICENSE.txt
 * That license requires this notice to be retained — keep it if you copy this file.
 *
 * The original implementation is in turn based on
 * "Efficient Algorithms for Finding Maximum Matching in Graphs" by Zvi Galil,
 * ACM Computing Surveys, 1986, and Joris van Rantwijk's reference
 * implementation. Runs in O(V^3).
 *
 * This is the same technique Coronate uses via `rescript-blossom` to solve
 * Swiss-system pairing as a weighted matching problem.
 */

type Node = number | Blossom;

const NO_NODE = Symbol("no-node");

class Blossom {
  childs: Node[] = [];
  edges: Array<[number, number]> = [];
  mybestedges: Array<[number, number]> | null = null;

  *leaves(): Generator<number> {
    const stack: Node[] = [...this.childs];
    while (stack.length) {
      const t = stack.pop()!;
      if (t instanceof Blossom) {
        stack.push(...t.childs);
      } else {
        yield t;
      }
    }
  }
}

function assert(cond: boolean, msg = ""): asserts cond {
  if (!cond) {
    throw new Error(`blossom algorithm invariant violated: ${msg}`);
  }
}

/** Python-style list indexing: negative and out-of-range indices wrap. */
function at<T>(arr: T[], idx: number): T {
  const n = arr.length;
  return arr[((idx % n) + n) % n];
}

/**
 * Compute a maximum-weight matching of an undirected graph on vertices
 * `0..numVertices-1`. Edge weights must be non-negative integers.
 *
 * @param maxCardinality if true, find the maximum-cardinality matching with
 *   maximum weight among all maximum-cardinality matchings (what Swiss
 *   pairing needs: pair as many players as possible).
 * @returns array of length numVertices; result[v] is v's matched partner,
 *   or -1 if v is unmatched.
 */
export function maxWeightMatching(
  numVertices: number,
  edges: Array<[number, number, number]>,
  maxCardinality = false,
): number[] {
  const gnodes: number[] = [];
  for (let v = 0; v < numVertices; v++) gnodes.push(v);
  if (gnodes.length === 0) return [];

  const adj = new Map<number, Map<number, number>>();
  for (const v of gnodes) adj.set(v, new Map());
  let maxweight = 0;
  let allinteger = true;
  for (const [i, j, wRaw] of edges) {
    const w = wRaw;
    if (!Number.isInteger(w)) allinteger = false;
    if (i === j) continue;
    adj.get(i)!.set(j, w);
    adj.get(j)!.set(i, w);
    if (w > maxweight) maxweight = w;
  }

  function neighbors(v: number): number[] {
    return [...adj.get(v)!.keys()];
  }
  function weight(v: number, w: number): number {
    return adj.get(v)!.get(w) ?? 1;
  }
  function slack(v: number, w: number): number {
    return dualvar.get(v)! + dualvar.get(w)! - 2 * weight(v, w);
  }

  const mate = new Map<number, number>();
  const label = new Map<Node, number>();
  const labeledge = new Map<Node, [number, number] | null>();
  const inblossom = new Map<number, Node>(gnodes.map((v) => [v, v]));
  const blossomparent = new Map<Node, Node | null>(gnodes.map((v) => [v, null]));
  const blossombase = new Map<Node, number>(gnodes.map((v) => [v, v]));
  const bestedge = new Map<Node, [number, number] | null>();
  const dualvar = new Map<number, number>(gnodes.map((v) => [v, maxweight]));
  const blossomdual = new Map<Blossom, number>();
  const allowedge = new Set<string>();
  let queue: number[] = [];

  function edgeKey(v: number, w: number): string {
    return v + "_" + w;
  }
  function isAllowed(v: number, w: number): boolean {
    return allowedge.has(edgeKey(v, w));
  }
  function setAllowed(v: number, w: number): void {
    allowedge.add(edgeKey(v, w));
    allowedge.add(edgeKey(w, v));
  }

  function assignLabel(w: number, t: 1 | 2, v: number | null): void {
    const b = inblossom.get(w)!;
    assert(label.get(w) === undefined && label.get(b) === undefined, "assignLabel");
    label.set(w, t);
    label.set(b, t);
    if (v !== null) {
      labeledge.set(w, [v, w]);
      labeledge.set(b, [v, w]);
    } else {
      labeledge.set(w, null);
      labeledge.set(b, null);
    }
    bestedge.set(w, null);
    bestedge.set(b, null);
    if (t === 1) {
      if (b instanceof Blossom) {
        for (const leaf of b.leaves()) queue.push(leaf);
      } else {
        queue.push(b);
      }
    } else if (t === 2) {
      const base = blossombase.get(b)!;
      assignLabel(mate.get(base)!, 1, base);
    }
  }

  function scanBlossom(vIn: number, wIn: number): number | typeof NO_NODE {
    const path: Node[] = [];
    let base: number | typeof NO_NODE = NO_NODE;
    let v: number | typeof NO_NODE = vIn;
    let w: number | typeof NO_NODE = wIn;
    while (v !== NO_NODE) {
      const vNum: number = v;
      const b: Node = inblossom.get(vNum)!;
      if ((label.get(b)! & 4) !== 0) {
        base = blossombase.get(b)!;
        break;
      }
      assert(label.get(b) === 1, "scanBlossom label S");
      path.push(b);
      label.set(b, 5);
      const le: [number, number] | null = labeledge.get(b)!;
      if (le === null) {
        v = NO_NODE;
      } else {
        assert(le[0] === mate.get(blossombase.get(b)!), "scanBlossom labeledge");
        const v1: number = le[0];
        const bb: Node = inblossom.get(v1)!;
        assert(label.get(bb) === 2, "scanBlossom T");
        const le2: [number, number] = labeledge.get(bb)!;
        v = le2[0];
      }
      if (w !== NO_NODE) {
        const tmp: number | typeof NO_NODE = v;
        v = w;
        w = tmp;
      }
    }
    for (const b of path) label.set(b, 1);
    return base;
  }

  function addBlossom(base: number, vIn: number, wIn: number): void {
    let v = vIn;
    let w = wIn;
    const bb = inblossom.get(base)!;
    let bv = inblossom.get(v)!;
    let bw = inblossom.get(w)!;
    const b = new Blossom();
    blossombase.set(b, base);
    blossomparent.set(b, null);
    blossomparent.set(bb, b);
    const path: Node[] = [];
    b.childs = path;
    const edgs: Array<[number, number]> = [[v, w]];
    b.edges = edgs;

    while (bv !== bb) {
      blossomparent.set(bv, b);
      path.push(bv);
      edgs.push(labeledge.get(bv)!);
      assert(
        label.get(bv) === 2 ||
          (label.get(bv) === 1 && labeledge.get(bv)![0] === mate.get(blossombase.get(bv)!)),
        "addBlossom trace v",
      );
      v = labeledge.get(bv)![0];
      bv = inblossom.get(v)!;
    }
    path.push(bb);
    path.reverse();
    edgs.reverse();

    while (bw !== bb) {
      blossomparent.set(bw, b);
      path.push(bw);
      const le = labeledge.get(bw)!;
      edgs.push([le[1], le[0]]);
      assert(
        label.get(bw) === 2 ||
          (label.get(bw) === 1 && labeledge.get(bw)![0] === mate.get(blossombase.get(bw)!)),
        "addBlossom trace w",
      );
      w = labeledge.get(bw)![0];
      bw = inblossom.get(w)!;
    }

    assert(label.get(bb) === 1, "addBlossom base S");
    label.set(b, 1);
    labeledge.set(b, labeledge.get(bb)!);
    blossomdual.set(b, 0);

    for (const leaf of b.leaves()) {
      if (label.get(inblossom.get(leaf)!) === 2) {
        queue.push(leaf);
      }
      inblossom.set(leaf, b);
    }

    const bestedgeto = new Map<Node, [number, number]>();
    for (const bvNode of path) {
      let nblist: Array<[number, number]>;
      if (bvNode instanceof Blossom) {
        if (bvNode.mybestedges !== null) {
          nblist = bvNode.mybestedges;
          bvNode.mybestedges = null;
        } else {
          nblist = [];
          for (const vv of bvNode.leaves()) {
            for (const ww of neighbors(vv)) {
              if (vv !== ww) nblist.push([vv, ww]);
            }
          }
        }
      } else {
        nblist = [];
        for (const ww of neighbors(bvNode)) {
          if (bvNode !== ww) nblist.push([bvNode, ww]);
        }
      }
      for (const pair of nblist) {
        let i = pair[0];
        let j = pair[1];
        if (inblossom.get(j) === b) {
          [i, j] = [j, i];
        }
        const bj = inblossom.get(j)!;
        if (
          bj !== b &&
          label.get(bj) === 1 &&
          (!bestedgeto.has(bj) || slack(i, j) < slack(...bestedgeto.get(bj)!))
        ) {
          bestedgeto.set(bj, [i, j]);
        }
      }
      bestedge.set(bvNode, null);
    }
    b.mybestedges = [...bestedgeto.values()];

    let mybestedge: [number, number] | null = null;
    let mybestslack = 0;
    bestedge.set(b, null);
    for (const k of b.mybestedges) {
      const kslack = slack(...k);
      if (mybestedge === null || kslack < mybestslack) {
        mybestedge = k;
        mybestslack = kslack;
      }
    }
    bestedge.set(b, mybestedge);
  }

  function expandBlossom(b: Blossom, endstage: boolean): void {
    for (const s of b.childs) {
      blossomparent.set(s, null);
      if (s instanceof Blossom) {
        if (endstage && blossomdual.get(s) === 0) {
          expandBlossom(s, endstage);
        } else {
          for (const v of s.leaves()) inblossom.set(v, s);
        }
      } else {
        inblossom.set(s, s);
      }
    }

    if (!endstage && label.get(b) === 2) {
      const entrychild = inblossom.get(labeledge.get(b)![1])!;
      let j = b.childs.indexOf(entrychild);
      let jstep: number;
      if (j & 1) {
        j -= b.childs.length;
        jstep = 1;
      } else {
        jstep = -1;
      }
      let [v, w] = labeledge.get(b)!;
      while (j !== 0) {
        let p: number, q: number;
        if (jstep === 1) {
          [p, q] = at(b.edges, j);
        } else {
          [q, p] = at(b.edges, j - 1);
        }
        label.delete(w);
        label.delete(q);
        assignLabel(w, 2, v);
        setAllowed(p, q);
        j += jstep;
        if (jstep === 1) {
          [v, w] = at(b.edges, j);
        } else {
          [w, v] = at(b.edges, j - 1);
        }
        setAllowed(v, w);
        j += jstep;
      }
      const bw = at(b.childs, j);
      label.set(w, 2);
      label.set(bw, 2);
      labeledge.set(w, [v, w]);
      labeledge.set(bw, [v, w]);
      bestedge.set(bw, null);
      j += jstep;
      while (at(b.childs, j) !== entrychild) {
        const bv = at(b.childs, j);
        if (label.get(bv) === 1) {
          j += jstep;
          continue;
        }
        let vv: number | undefined;
        if (bv instanceof Blossom) {
          for (const leaf of bv.leaves()) {
            if (label.get(leaf) !== undefined) {
              vv = leaf;
              break;
            }
          }
        } else {
          vv = bv;
        }
        if (vv !== undefined && label.get(vv) !== undefined) {
          assert(label.get(vv) === 2, "expandBlossom relabel T");
          assert(inblossom.get(vv) === bv, "expandBlossom inblossom");
          label.delete(vv);
          label.delete(mate.get(blossombase.get(bv)!)!);
          assignLabel(vv, 2, labeledge.get(vv)![0]);
        }
        j += jstep;
      }
    }

    label.delete(b);
    labeledge.delete(b);
    bestedge.delete(b);
    blossomparent.delete(b);
    blossombase.delete(b);
    blossomdual.delete(b);
  }

  function augmentBlossom(b: Blossom, vIn: number): void {
    let t: Node = vIn;
    while (blossomparent.get(t) !== b) {
      t = blossomparent.get(t)!;
    }
    if (t instanceof Blossom) {
      augmentBlossom(t, vIn);
    }
    const i = b.childs.indexOf(t);
    let j = i;
    let jstep: number;
    if (i & 1) {
      j -= b.childs.length;
      jstep = 1;
    } else {
      jstep = -1;
    }
    while (j !== 0) {
      j += jstep;
      t = at(b.childs, j);
      let w: number, x: number;
      if (jstep === 1) {
        [w, x] = at(b.edges, j);
      } else {
        [x, w] = at(b.edges, j - 1);
      }
      if (t instanceof Blossom) {
        augmentBlossom(t, w);
      }
      j += jstep;
      t = at(b.childs, j);
      if (t instanceof Blossom) {
        augmentBlossom(t, x);
      }
      mate.set(w, x);
      mate.set(x, w);
    }
    b.childs = [...b.childs.slice(i), ...b.childs.slice(0, i)];
    b.edges = [...b.edges.slice(i), ...b.edges.slice(0, i)];
    blossombase.set(b, blossombase.get(b.childs[0])!);
    assert(blossombase.get(b) === vIn, "augmentBlossom base");
  }

  function augmentMatching(vIn: number, wIn: number): void {
    const pairs: Array<[number, number]> = [
      [vIn, wIn],
      [wIn, vIn],
    ];
    for (const [sIn, jIn] of pairs) {
      let s = sIn;
      let j = jIn;
      while (true) {
        const bs = inblossom.get(s)!;
        assert(label.get(bs) === 1, "augmentMatching S");
        assert(
          (labeledge.get(bs) === null && !mate.has(blossombase.get(bs)!)) ||
            labeledge.get(bs)![0] === mate.get(blossombase.get(bs)!),
          "augmentMatching labeledge",
        );
        if (bs instanceof Blossom) {
          augmentBlossom(bs, s);
        }
        mate.set(s, j);
        if (labeledge.get(bs) === null) {
          break;
        }
        const t = labeledge.get(bs)![0];
        const bt = inblossom.get(t)!;
        assert(label.get(bt) === 2, "augmentMatching T");
        [s, j] = labeledge.get(bt)!;
        assert(blossombase.get(bt) === t, "augmentMatching base");
        if (bt instanceof Blossom) {
          augmentBlossom(bt, j);
        }
        mate.set(j, s);
      }
    }
  }

  function verifyOptimum(): void {
    const dualvals = [...dualvar.values()];
    const vdualoffset = maxCardinality ? Math.max(0, -Math.min(...dualvals)) : 0;
    assert(Math.min(...dualvals) + vdualoffset >= 0, "verify dual >= 0");
    assert(blossomdual.size === 0 || Math.min(...blossomdual.values()) >= 0, "verify blossomdual >= 0");

    for (const [i, j, wRaw] of edges) {
      if (i === j) continue;
      let s = dualvar.get(i)! + dualvar.get(j)! - 2 * wRaw;
      const iblossoms: Node[] = [i];
      const jblossoms: Node[] = [j];
      while (blossomparent.get(iblossoms[iblossoms.length - 1])! !== null) {
        iblossoms.push(blossomparent.get(iblossoms[iblossoms.length - 1])!);
      }
      while (blossomparent.get(jblossoms[jblossoms.length - 1])! !== null) {
        jblossoms.push(blossomparent.get(jblossoms[jblossoms.length - 1])!);
      }
      iblossoms.reverse();
      jblossoms.reverse();
      const len = Math.min(iblossoms.length, jblossoms.length);
      for (let k = 0; k < len; k++) {
        const bi = iblossoms[k];
        const bj = jblossoms[k];
        if (bi !== bj) break;
        s += 2 * (blossomdual.get(bi as Blossom) ?? 0);
      }
      assert(s >= 0, "verify slack >= 0");
      if (mate.get(i) === j || mate.get(j) === i) {
        assert(mate.get(i) === j && mate.get(j) === i, "verify matched symmetric");
        assert(s === 0, "verify matched zero slack");
      }
    }
    for (const v of gnodes) {
      assert(mate.has(v) || dualvar.get(v)! + vdualoffset === 0, "verify single vertex zero dual");
    }
    for (const b of blossomdual.keys()) {
      if (blossomdual.get(b)! > 0) {
        assert(b.edges.length % 2 === 1, "verify blossom odd");
        for (let idx = 1; idx < b.edges.length; idx += 2) {
          const [i, j] = b.edges[idx];
          assert(mate.get(i) === j && mate.get(j) === i, "verify blossom full");
        }
      }
    }
  }

  // Main loop: each iteration is a "stage" that finds one augmenting path.
  while (true) {
    label.clear();
    labeledge.clear();
    bestedge.clear();
    for (const b of blossomdual.keys()) {
      b.mybestedges = null;
    }
    allowedge.clear();
    queue = [];

    for (const v of gnodes) {
      if (!mate.has(v) && label.get(inblossom.get(v)!) === undefined) {
        assignLabel(v, 1, null);
      }
    }

    let augmented = false;
    while (true) {
      while (queue.length && !augmented) {
        const v = queue.pop()!;
        assert(label.get(inblossom.get(v)!) === 1, "main loop S vertex");

        for (const w of neighbors(v)) {
          if (w === v) continue;
          const bv = inblossom.get(v)!;
          const bw = inblossom.get(w)!;
          if (bv === bw) continue;

          let kslack = 0;
          if (!isAllowed(v, w)) {
            kslack = slack(v, w);
            if (kslack <= 0) setAllowed(v, w);
          }
          if (isAllowed(v, w)) {
            if (label.get(bw) === undefined) {
              assignLabel(w, 2, v);
            } else if (label.get(bw) === 1) {
              const base = scanBlossom(v, w);
              if (base !== NO_NODE) {
                addBlossom(base as number, v, w);
              } else {
                augmentMatching(v, w);
                augmented = true;
                break;
              }
            } else if (label.get(w) === undefined) {
              assert(label.get(bw) === 2, "main loop T unreached");
              label.set(w, 2);
              labeledge.set(w, [v, w]);
            }
          } else if (label.get(bw) === 1) {
            if (bestedge.get(bv) == null || kslack < slack(...bestedge.get(bv)!)) {
              bestedge.set(bv, [v, w]);
            }
          } else if (label.get(w) === undefined) {
            if (bestedge.get(w) == null || kslack < slack(...bestedge.get(w)!)) {
              bestedge.set(w, [v, w]);
            }
          }
        }
      }

      if (augmented) break;

      let deltatype = -1;
      let delta = 0;
      let deltaedge: [number, number] | null = null;
      let deltablossom: Blossom | null = null;

      if (!maxCardinality) {
        deltatype = 1;
        delta = Math.min(...dualvar.values());
      }

      for (const v of gnodes) {
        if (label.get(inblossom.get(v)!) === undefined && bestedge.get(v) != null) {
          const d = slack(...bestedge.get(v)!);
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 2;
            deltaedge = bestedge.get(v)!;
          }
        }
      }

      for (const b of blossomparent.keys()) {
        if (blossomparent.get(b) === null && label.get(b) === 1 && bestedge.get(b) != null) {
          const kslack = slack(...bestedge.get(b)!);
          const d = kslack / 2;
          if (allinteger) assert(kslack % 2 === 0, "delta3 integer");
          if (deltatype === -1 || d < delta) {
            delta = d;
            deltatype = 3;
            deltaedge = bestedge.get(b)!;
          }
        }
      }

      for (const b of blossomdual.keys()) {
        if (
          blossomparent.get(b) === null &&
          label.get(b) === 2 &&
          (deltatype === -1 || blossomdual.get(b)! < delta)
        ) {
          delta = blossomdual.get(b)!;
          deltatype = 4;
          deltablossom = b;
        }
      }

      if (deltatype === -1) {
        assert(maxCardinality, "no delta type without maxCardinality");
        deltatype = 1;
        delta = Math.max(0, Math.min(...dualvar.values()));
      }

      for (const v of gnodes) {
        const lb = label.get(inblossom.get(v)!);
        if (lb === 1) {
          dualvar.set(v, dualvar.get(v)! - delta);
        } else if (lb === 2) {
          dualvar.set(v, dualvar.get(v)! + delta);
        }
      }
      for (const b of blossomdual.keys()) {
        if (blossomparent.get(b) === null) {
          if (label.get(b) === 1) {
            blossomdual.set(b, blossomdual.get(b)! + delta);
          } else if (label.get(b) === 2) {
            blossomdual.set(b, blossomdual.get(b)! - delta);
          }
        }
      }

      if (deltatype === 1) {
        break;
      } else if (deltatype === 2) {
        const [v, w] = deltaedge!;
        assert(label.get(inblossom.get(v)!) === 1, "delta2 S");
        setAllowed(v, w);
        queue.push(v);
      } else if (deltatype === 3) {
        const [v, w] = deltaedge!;
        setAllowed(v, w);
        assert(label.get(inblossom.get(v)!) === 1, "delta3 S");
        queue.push(v);
      } else if (deltatype === 4) {
        expandBlossom(deltablossom!, false);
      }
    }

    for (const [vv, mm] of mate) {
      assert(mate.get(mm) === vv, "paranoia symmetric mate");
    }

    if (!augmented) break;

    for (const b of [...blossomdual.keys()]) {
      if (!blossomdual.has(b)) continue;
      if (blossomparent.get(b) === null && label.get(b) === 1 && blossomdual.get(b) === 0) {
        expandBlossom(b, true);
      }
    }
  }

  if (allinteger) {
    verifyOptimum();
  }

  const result = new Array(numVertices).fill(-1);
  for (const [v, m] of mate) result[v] = m;
  return result;
}
