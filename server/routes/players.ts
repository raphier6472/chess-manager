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
  roster_player_id: string;
}

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    lastName: row.last_name,
    firstName: row.first_name,
    rating: row.rating,
    withdrawn: row.withdrawn === 1,
    rosterPlayerId: row.roster_player_id,
  };
}

router.get("/tournaments/:tournamentId/players", (req, res) => {
  const activo = db
    .prepare("SELECT id FROM tournaments WHERE id = ? AND deleted_at IS NULL")
    .get(req.params.tournamentId);
  if (!activo) return res.status(404).json({ error: "no se encontró el torneo" });

  const rows = db
    .prepare(
      "SELECT * FROM players WHERE tournament_id = ? ORDER BY rating IS NULL, rating DESC, last_name, first_name",
    )
    .all(req.params.tournamentId) as PlayerRow[];
  res.json(rows.map(toPlayer));
});

router.post("/tournaments/:tournamentId/players", requireAuth, (req, res) => {
  const tournament = db
    .prepare("SELECT id FROM tournaments WHERE id = ? AND deleted_at IS NULL")
    .get(req.params.tournamentId);
  if (!tournament) return res.status(404).json({ error: "no se encontró el torneo" });

  const { lastName, firstName, rating, rosterPlayerId } = req.body ?? {};
  const parsedRating = parseRating(rating);
  if ("error" in parsedRating) {
    return res.status(400).json({ error: parsedRating.error });
  }
  const ratingValue = parsedRating.value;

  let lastNameValue: string;
  let firstNameValue: string;
  let rosterId: string;

  if (typeof rosterPlayerId === "string" && rosterPlayerId) {
    // Reusar una persona del padrón: el nombre viene de ahí, no del body, para que
    // no queden dos grafías distintas del mismo jugador entre torneos.
    const rosterRow = db
      .prepare("SELECT * FROM roster_players WHERE id = ?")
      .get(rosterPlayerId) as { id: string; last_name: string; first_name: string } | undefined;
    if (!rosterRow) return res.status(404).json({ error: "no se encontró esa persona en el padrón" });
    lastNameValue = rosterRow.last_name;
    firstNameValue = rosterRow.first_name;
    rosterId = rosterRow.id;
  } else {
    if (typeof lastName !== "string" || !lastName.trim()) {
      return res.status(400).json({ error: "el apellido es obligatorio" });
    }
    lastNameValue = lastName.trim();
    firstNameValue = typeof firstName === "string" ? firstName.trim() : "";
    // Sin rosterPlayerId, es una persona nueva: se crea su fila en el padrón acá.
    // Deliberadamente no se busca por nombre para reusar una existente (sería el
    // mismo problema de fondo que el padrón vino a resolver: un tilde o un typo
    // separaría a la misma persona en dos identidades igual). El buscador del
    // padrón (GET /roster) es el camino para reusar una identidad a propósito.
    rosterId = nanoid();
    db.prepare("INSERT INTO roster_players (id, last_name, first_name) VALUES (?, ?, ?)").run(
      rosterId,
      lastNameValue,
      firstNameValue,
    );
  }

  const id = nanoid();
  db.prepare(
    "INSERT INTO players (id, tournament_id, last_name, first_name, rating, withdrawn, roster_player_id) VALUES (?, ?, ?, ?, ?, 0, ?)",
  ).run(id, req.params.tournamentId, lastNameValue, firstNameValue, ratingValue, rosterId);
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

  // El límite real no es el estado del torneo sino si el jugador ya tiene alguna partida
  // registrada: borrarlo ahí rompería la historia de esa ronda y las posiciones que se
  // calcularon con ella. Un jugador agregado por error después de emparejar (o que nunca
  // llegó a jugar) no tiene ese problema y antes quedaba atrapado sin poder sacarlo, solo
  // "retirar" — que lo deja para siempre en la lista con el nombre mal cargado.
  const hasMatches = db
    .prepare("SELECT 1 FROM matches WHERE white_id = ? OR black_id = ? LIMIT 1")
    .get(player.id, player.id);
  if (hasMatches) {
    return res.status(409).json({
      error: "no se puede quitar un jugador que ya tiene partidas registradas; retíralo en su lugar",
    });
  }

  db.prepare("DELETE FROM players WHERE id = ?").run(player.id);
  res.status(204).end();
});

export default router;
