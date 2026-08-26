import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db";
import type { Player } from "../../shared/types";
import { requireAuth } from "../middleware/auth";

const router = Router();

// El Elo se guarda en una columna INTEGER, pero SQLite es de tipado laxo: sin esta
// validación entraban decimales y negativos (ej. -9999.5) tal cual.
const MIN_RATING = 0;
const MAX_RATING = 4000;

/** null = sin Elo. Devuelve un mensaje de error si el valor es inválido. */
function parseRating(raw: unknown): { value: number | null } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_RATING || value > MAX_RATING) {
    return { error: `el Elo debe ser un número entero entre ${MIN_RATING} y ${MAX_RATING}` };
  }
  return { value };
}

interface PlayerRow {
  id: string;
  tournament_id: string;
  last_name: string;
  first_name: string;
  rating: number | null;
  withdrawn: number;
}

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    lastName: row.last_name,
    firstName: row.first_name,
    rating: row.rating,
    withdrawn: row.withdrawn === 1,
  };
}

router.get("/tournaments/:tournamentId/players", (req, res) => {
  const rows = db
    .prepare(
      "SELECT * FROM players WHERE tournament_id = ? ORDER BY rating IS NULL, rating DESC, last_name, first_name",
    )
    .all(req.params.tournamentId) as PlayerRow[];
  res.json(rows.map(toPlayer));
});

router.post("/tournaments/:tournamentId/players", requireAuth, (req, res) => {
  const tournament = db.prepare("SELECT id FROM tournaments WHERE id = ?").get(req.params.tournamentId);
  if (!tournament) return res.status(404).json({ error: "no se encontró el torneo" });

  const { lastName, firstName, rating } = req.body ?? {};
  if (typeof lastName !== "string" || !lastName.trim()) {
    return res.status(400).json({ error: "el apellido es obligatorio" });
  }
  const firstNameValue = typeof firstName === "string" ? firstName.trim() : "";
  const parsedRating = parseRating(rating);
  if ("error" in parsedRating) {
    return res.status(400).json({ error: parsedRating.error });
  }
  const ratingValue = parsedRating.value;

  const id = nanoid();
  db.prepare(
    "INSERT INTO players (id, tournament_id, last_name, first_name, rating, withdrawn) VALUES (?, ?, ?, ?, ?, 0)",
  ).run(id, req.params.tournamentId, lastName.trim(), firstNameValue, ratingValue);
  const row = db.prepare("SELECT * FROM players WHERE id = ?").get(id) as PlayerRow;
  res.status(201).json(toPlayer(row));
});

router.patch("/players/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id) as
    | PlayerRow
    | undefined;
  if (!row) return res.status(404).json({ error: "no se encontró el jugador" });

  const { withdrawn, lastName, firstName, rating } = req.body ?? {};

  // Validar antes de escribir nada: los updates son incrementales, así que un rating
  // inválido al final dejaría el nombre ya modificado y la request igual fallando.
  const parsedRating = rating === undefined ? null : parseRating(rating);
  if (parsedRating && "error" in parsedRating) {
    return res.status(400).json({ error: parsedRating.error });
  }

  if (withdrawn !== undefined) {
    db.prepare("UPDATE players SET withdrawn = ? WHERE id = ?").run(withdrawn ? 1 : 0, row.id);
  }
  if (typeof lastName === "string" && lastName.trim()) {
    db.prepare("UPDATE players SET last_name = ? WHERE id = ?").run(lastName.trim(), row.id);
  }
  if (typeof firstName === "string") {
    db.prepare("UPDATE players SET first_name = ? WHERE id = ?").run(firstName.trim(), row.id);
  }
  if (parsedRating) {
    db.prepare("UPDATE players SET rating = ? WHERE id = ?").run(parsedRating.value, row.id);
  }

  const updated = db.prepare("SELECT * FROM players WHERE id = ?").get(row.id) as PlayerRow;
  res.json(toPlayer(updated));
});

router.delete("/players/:id", requireAuth, (req, res) => {
  const player = db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id) as
    | PlayerRow
    | undefined;
  if (!player) return res.status(404).json({ error: "no se encontró el jugador" });

  const tournament = db
    .prepare("SELECT status FROM tournaments WHERE id = ?")
    .get(player.tournament_id) as { status: string } | undefined;
  if (tournament && tournament.status !== "setup") {
    return res.status(409).json({
      error: "no se puede quitar un jugador con el torneo empezado; retíralo en su lugar",
    });
  }

  db.prepare("DELETE FROM players WHERE id = ?").run(player.id);
  res.status(204).end();
});

export default router;
