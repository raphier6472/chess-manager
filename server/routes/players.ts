import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db";
import type { Player } from "../../shared/types";
import { requireAuth } from "../middleware/auth";

const router = Router();

interface PlayerRow {
  id: string;
  tournament_id: string;
  name: string;
  rating: number | null;
  withdrawn: number;
}

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    rating: row.rating,
    withdrawn: row.withdrawn === 1,
  };
}

router.get("/tournaments/:tournamentId/players", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM players WHERE tournament_id = ? ORDER BY rating IS NULL, rating DESC, name")
    .all(req.params.tournamentId) as PlayerRow[];
  res.json(rows.map(toPlayer));
});

router.post("/tournaments/:tournamentId/players", requireAuth, (req, res) => {
  const tournament = db.prepare("SELECT id FROM tournaments WHERE id = ?").get(req.params.tournamentId);
  if (!tournament) return res.status(404).json({ error: "tournament not found" });

  const { name, rating } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const ratingValue = rating === undefined || rating === null || rating === "" ? null : Number(rating);
  if (ratingValue !== null && !Number.isFinite(ratingValue)) {
    return res.status(400).json({ error: "rating must be a number" });
  }

  const id = nanoid();
  db.prepare(
    "INSERT INTO players (id, tournament_id, name, rating, withdrawn) VALUES (?, ?, ?, ?, 0)",
  ).run(id, req.params.tournamentId, name.trim(), ratingValue);
  const row = db.prepare("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow;
  res.status(201).json(toPlayer(row));
});

router.patch("/players/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id) as
    | PlayerRow
    | undefined;
  if (!row) return res.status(404).json({ error: "player not found" });

  const { withdrawn, name, rating } = req.body ?? {};
  if (withdrawn !== undefined) {
    db.prepare("UPDATE players SET withdrawn = ? WHERE id = ?").run(withdrawn ? 1 : 0, row.id);
  }
  if (typeof name === "string" && name.trim()) {
    db.prepare("UPDATE players SET name = ? WHERE id = ?").run(name.trim(), row.id);
  }
  if (rating !== undefined) {
    const ratingValue = rating === null || rating === "" ? null : Number(rating);
    db.prepare("UPDATE players SET rating = ? WHERE id = ?").run(ratingValue, row.id);
  }

  const updated = db.prepare("SELECT * FROM players WHERE id = ?").get(row.id) as PlayerRow;
  res.json(toPlayer(updated));
});

router.delete("/players/:id", requireAuth, (req, res) => {
  const player = db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id) as
    | PlayerRow
    | undefined;
  if (!player) return res.status(404).json({ error: "player not found" });

  const tournament = db
    .prepare("SELECT status FROM tournaments WHERE id = ?")
    .get(player.tournament_id) as { status: string } | undefined;
  if (tournament && tournament.status !== "setup") {
    return res.status(409).json({
      error: "cannot delete a player once the tournament has started; withdraw them instead",
    });
  }

  db.prepare("DELETE FROM players WHERE id = ?").run(player.id);
  res.status(204).end();
});

export default router;
