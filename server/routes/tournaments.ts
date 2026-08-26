import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db";
import { formatPlayerName, type Tournament } from "../../shared/types";
import { computeStandings, type MatchOutcome } from "../scoring/tiebreaks";
import { requireAuth } from "../middleware/auth";

const router = Router();

interface TournamentRow {
  id: string;
  name: string;
  date: string;
  num_rounds: number;
  status: string;
}

function toTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    numRounds: row.num_rounds,
    status: row.status as Tournament["status"],
  };
}

router.get("/tournaments", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM tournaments ORDER BY date DESC, name")
    .all() as TournamentRow[];
  res.json(rows.map(toTournament));
});

router.post("/tournaments", requireAuth, (req, res) => {
  const { name, date, numRounds } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (typeof date !== "string" || !date.trim()) {
    return res.status(400).json({ error: "date is required" });
  }
  const rounds = Number(numRounds);
  if (!Number.isInteger(rounds) || rounds < 1) {
    return res.status(400).json({ error: "numRounds must be a positive integer" });
  }
  const id = nanoid();
  db.prepare(
    "INSERT INTO tournaments (id, name, date, num_rounds, status) VALUES (?, ?, ?, ?, 'setup')",
  ).run(id, name.trim(), date.trim(), rounds);
  const row = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id) as TournamentRow;
  res.status(201).json(toTournament(row));
});

router.get("/tournaments/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id) as
    | TournamentRow
    | undefined;
  if (!row) return res.status(404).json({ error: "tournament not found" });
  res.json(toTournament(row));
});

router.delete("/tournaments/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT status FROM tournaments WHERE id = ?").get(req.params.id) as
    | { status: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "tournament not found" });
  if (row.status === "active") {
    return res
      .status(409)
      .json({ error: "no se puede eliminar un torneo mientras está en curso" });
  }
  db.prepare("DELETE FROM tournaments WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.get("/tournaments/:id/standings", (req, res) => {
  const tournamentId = req.params.id;
  const tournament = db.prepare("SELECT id FROM tournaments WHERE id = ?").get(tournamentId);
  if (!tournament) return res.status(404).json({ error: "tournament not found" });

  const playerRows = db
    .prepare("SELECT id, last_name, first_name FROM players WHERE tournament_id = ?")
    .all(tournamentId) as Array<{ id: string; last_name: string; first_name: string }>;
  const players = playerRows.map((p) => ({
    id: p.id,
    name: formatPlayerName({ lastName: p.last_name, firstName: p.first_name }),
  }));

  const matches = db
    .prepare(
      `SELECT m.white_id, m.black_id, m.result
       FROM matches m
       JOIN rounds r ON r.id = m.round_id
       WHERE r.tournament_id = ? AND r.status = 'completed'`,
    )
    .all(tournamentId) as Array<{ white_id: string; black_id: string | null; result: string }>;

  const history = new Map<string, MatchOutcome[]>();
  const push = (playerId: string, outcome: MatchOutcome) => {
    if (!history.has(playerId)) history.set(playerId, []);
    history.get(playerId)!.push(outcome);
  };

  for (const m of matches) {
    if (m.black_id === null || m.result === "bye") {
      push(m.white_id, { opponentId: null, result: "bye" });
      continue;
    }
    if (m.result === "draw") {
      push(m.white_id, { opponentId: m.black_id, result: "draw" });
      push(m.black_id, { opponentId: m.white_id, result: "draw" });
    } else if (m.result === "white") {
      push(m.white_id, { opponentId: m.black_id, result: "win" });
      push(m.black_id, { opponentId: m.white_id, result: "loss" });
    } else if (m.result === "black") {
      push(m.white_id, { opponentId: m.black_id, result: "loss" });
      push(m.black_id, { opponentId: m.white_id, result: "win" });
    }
  }

  res.json(computeStandings(players, history));
});

export default router;
