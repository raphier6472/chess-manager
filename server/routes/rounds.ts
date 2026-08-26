import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db";
import type { Match, Round } from "../../shared/types";
import { generateInitialPairings, generatePairings, type PairingPair, type PairingPlayer } from "../pairing/pairing";
import { requireAuth } from "../middleware/auth";

const router = Router();

interface RoundRow {
  id: string;
  tournament_id: string;
  number: number;
  status: string;
}
interface MatchRow {
  id: string;
  round_id: string;
  white_id: string;
  black_id: string | null;
  result: string;
}

function toRound(row: RoundRow): Round {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    number: row.number,
    status: row.status as Round["status"],
  };
}
function toMatch(row: MatchRow): Match {
  return {
    id: row.id,
    roundId: row.round_id,
    whiteId: row.white_id,
    blackId: row.black_id,
    result: row.result as Match["result"],
  };
}

router.get("/tournaments/:tournamentId/rounds", (req, res) => {
  const rounds = db
    .prepare("SELECT * FROM rounds WHERE tournament_id = ? ORDER BY number")
    .all(req.params.tournamentId) as RoundRow[];
  const result = rounds.map((r) => {
    const matches = db.prepare("SELECT * FROM matches WHERE round_id = ?").all(r.id) as MatchRow[];
    return { ...toRound(r), matches: matches.map(toMatch) };
  });
  res.json(result);
});

router.post("/tournaments/:tournamentId/rounds/generate", requireAuth, (req, res) => {
  const tournamentId = req.params.tournamentId;
  const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(tournamentId) as
    | { id: string; num_rounds: number; status: string }
    | undefined;
  if (!tournament) return res.status(404).json({ error: "no se encontró el torneo" });

  const existingRounds = db
    .prepare("SELECT * FROM rounds WHERE tournament_id = ? ORDER BY number")
    .all(tournamentId) as RoundRow[];

  if (existingRounds.length >= tournament.num_rounds) {
    return res.status(409).json({ error: "el torneo ya jugó todas sus rondas" });
  }
  if (existingRounds.length > 0) {
    const last = existingRounds[existingRounds.length - 1];
    if (last.status !== "completed") {
      return res.status(409).json({ error: "primero tienes que cerrar la ronda anterior" });
    }
  }

  const players = db
    .prepare("SELECT id, last_name, first_name, rating FROM players WHERE tournament_id = ? AND withdrawn = 0")
    .all(tournamentId) as Array<{ id: string; last_name: string; first_name: string; rating: number | null }>;
  if (players.length < 2) {
    return res.status(409).json({ error: "hacen falta al menos 2 jugadores activos para emparejar" });
  }

  let pairs: PairingPair[];
  let bye: string | null;

  if (existingRounds.length === 0) {
    // Round 1: standard Swiss fold seeding by rating (see generateInitialPairings).
    const seedPlayers = players.map((p) => ({
      id: p.id,
      lastName: p.last_name,
      firstName: p.first_name,
      rating: p.rating,
    }));
    ({ pairs, bye } = generateInitialPairings(seedPlayers));
  } else {
    const matches = db
      .prepare(
        `SELECT m.white_id, m.black_id, m.result
         FROM matches m JOIN rounds r ON r.id = m.round_id
         WHERE r.tournament_id = ?`,
      )
      .all(tournamentId) as Array<{ white_id: string; black_id: string | null; result: string }>;

    const scoreOf = new Map<string, number>();
    const opponentsOf = new Map<string, Set<string>>();
    const colorBalanceOf = new Map<string, number>();
    const hadByeOf = new Map<string, boolean>();
    for (const p of players) {
      scoreOf.set(p.id, 0);
      opponentsOf.set(p.id, new Set());
      colorBalanceOf.set(p.id, 0);
      hadByeOf.set(p.id, false);
    }
    const addScore = (id: string, pts: number) => {
      if (scoreOf.has(id)) scoreOf.set(id, scoreOf.get(id)! + pts);
    };

    for (const m of matches) {
      if (m.black_id === null) {
        if (hadByeOf.has(m.white_id)) hadByeOf.set(m.white_id, true);
        addScore(m.white_id, 1);
        continue;
      }
      opponentsOf.get(m.white_id)?.add(m.black_id);
      opponentsOf.get(m.black_id)?.add(m.white_id);
      if (colorBalanceOf.has(m.white_id)) {
        colorBalanceOf.set(m.white_id, colorBalanceOf.get(m.white_id)! + 1);
      }
      if (colorBalanceOf.has(m.black_id)) {
        colorBalanceOf.set(m.black_id, colorBalanceOf.get(m.black_id)! - 1);
      }
      if (m.result === "white") {
        addScore(m.white_id, 1);
      } else if (m.result === "black") {
        addScore(m.black_id, 1);
      } else if (m.result === "draw") {
        addScore(m.white_id, 0.5);
        addScore(m.black_id, 0.5);
      }
    }

    const pairingPlayers: PairingPlayer[] = players.map((p) => ({
      id: p.id,
      score: scoreOf.get(p.id) ?? 0,
      colorBalance: colorBalanceOf.get(p.id) ?? 0,
      opponents: opponentsOf.get(p.id) ?? new Set(),
      hadBye: hadByeOf.get(p.id) ?? false,
    }));

    ({ pairs, bye } = generatePairings(pairingPlayers));
  }

  const roundId = nanoid();
  const roundNumber = existingRounds.length + 1;

  const insertRound = db.prepare(
    "INSERT INTO rounds (id, tournament_id, number, status) VALUES (?, ?, ?, 'paired')",
  );
  const insertMatch = db.prepare(
    "INSERT INTO matches (id, round_id, white_id, black_id, result) VALUES (?, ?, ?, ?, ?)",
  );
  const setTournamentActive = db.prepare(
    "UPDATE tournaments SET status = 'active' WHERE id = ? AND status = 'setup'",
  );

  const tx = db.transaction(() => {
    insertRound.run(roundId, tournamentId, roundNumber);
    for (const pair of pairs) {
      insertMatch.run(nanoid(), roundId, pair.white, pair.black, "unplayed");
    }
    if (bye) {
      insertMatch.run(nanoid(), roundId, bye, null, "bye");
    }
    setTournamentActive.run(tournamentId);
  });
  tx();

  const roundRow = db.prepare("SELECT * FROM rounds WHERE id = ?").get(roundId) as RoundRow;
  const matchRows = db.prepare("SELECT * FROM matches WHERE round_id = ?").all(roundId) as MatchRow[];
  res.status(201).json({ ...toRound(roundRow), matches: matchRows.map(toMatch) });
});

router.post("/matches/:id/result", requireAuth, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id) as
    | MatchRow
    | undefined;
  if (!match) return res.status(404).json({ error: "no se encontró la partida" });
  if (match.black_id === null) {
    return res.status(409).json({ error: "un bye no lleva resultado" });
  }
  // La UI deshabilita el picker en una ronda cerrada, pero eso es solo cosmético:
  // sin esta guarda se puede reescribir el resultado (y dar vuelta el podio) de un
  // torneo ya terminado, o corromper los puntajes que alimentaron rondas posteriores.
  const round = db.prepare("SELECT status FROM rounds WHERE id = ?").get(match.round_id) as
    | { status: string }
    | undefined;
  if (round?.status === "completed") {
    return res
      .status(409)
      .json({ error: "no se puede cambiar el resultado de una ronda ya cerrada" });
  }
  const { result } = req.body ?? {};
  if (!["white", "black", "draw"].includes(result)) {
    return res.status(400).json({ error: "el resultado debe ser 1-0, ½-½ o 0-1" });
  }
  db.prepare("UPDATE matches SET result = ? WHERE id = ?").run(result, match.id);
  const updated = db.prepare("SELECT * FROM matches WHERE id = ?").get(match.id) as MatchRow;
  res.json(toMatch(updated));
});

router.post("/rounds/:id/complete", requireAuth, (req, res) => {
  const round = db.prepare("SELECT * FROM rounds WHERE id = ?").get(req.params.id) as
    | RoundRow
    | undefined;
  if (!round) return res.status(404).json({ error: "no se encontró la ronda" });
  if (round.status === "completed") {
    return res.status(409).json({ error: "la ronda ya está cerrada" });
  }

  const matches = db.prepare("SELECT * FROM matches WHERE round_id = ?").all(round.id) as MatchRow[];
  const pending = matches.some((m) => m.result === "unplayed");
  if (pending) {
    return res
      .status(409)
      .json({ error: "carga el resultado de todas las mesas antes de cerrar la ronda" });
  }

  const tournament = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(round.tournament_id) as
    | { num_rounds: number }
    | undefined;

  const tx = db.transaction(() => {
    db.prepare("UPDATE rounds SET status = 'completed' WHERE id = ?").run(round.id);
    if (tournament && round.number >= tournament.num_rounds) {
      db.prepare("UPDATE tournaments SET status = 'completed' WHERE id = ?").run(round.tournament_id);
    }
  });
  tx();

  const updated = db.prepare("SELECT * FROM rounds WHERE id = ?").get(round.id) as RoundRow;
  res.json(toRound(updated));
});

/**
 * Reabre la última ronda cerrada para corregir un resultado mal cargado.
 * Solo la última, y solo mientras no se haya emparejado la siguiente: tocar una ronda
 * vieja cambiaría los puntajes sobre los que ya se armaron los cruces posteriores.
 */
router.post("/rounds/:id/reopen", requireAuth, (req, res) => {
  const round = db.prepare("SELECT * FROM rounds WHERE id = ?").get(req.params.id) as
    | RoundRow
    | undefined;
  if (!round) return res.status(404).json({ error: "no se encontró la ronda" });
  if (round.status !== "completed") {
    return res.status(409).json({ error: "la ronda no está cerrada" });
  }

  const later = db
    .prepare("SELECT COUNT(*) AS n FROM rounds WHERE tournament_id = ? AND number > ?")
    .get(round.tournament_id, round.number) as { n: number };
  if (later.n > 0) {
    return res.status(409).json({
      error: "solo se puede reabrir la última ronda; ya se emparejó una posterior",
    });
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE rounds SET status = 'paired' WHERE id = ?").run(round.id);
    // Si el torneo había quedado terminado por ser la última ronda, vuelve a estar en curso.
    db.prepare("UPDATE tournaments SET status = 'active' WHERE id = ? AND status = 'completed'").run(
      round.tournament_id,
    );
  });
  tx();

  const reopened = db.prepare("SELECT * FROM rounds WHERE id = ?").get(round.id) as RoundRow;
  res.json(toRound(reopened));
});

export default router;
