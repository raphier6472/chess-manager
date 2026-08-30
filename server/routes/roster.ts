import { Router } from "express";
import { db } from "../db";
import type { RosterPlayer } from "../../shared/types";
import { requireAuth } from "../middleware/auth";

const router = Router();

const MAX_RESULTS = 15;

interface RosterPlayerRow {
  id: string;
  last_name: string;
  first_name: string;
}

function toRosterPlayer(row: RosterPlayerRow): RosterPlayer {
  return { id: row.id, lastName: row.last_name, firstName: row.first_name };
}

/**
 * Buscador para reutilizar una identidad del padrón al agregar un jugador a un torneo
 * (ver POST /tournaments/:tournamentId/players en players.ts). Requiere sesión de
 * organizador porque solo se usa desde el alta de jugadores, que ya es una acción
 * restringida.
 */
router.get("/roster", requireAuth, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.json([]);

  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT * FROM roster_players
       WHERE last_name LIKE ? OR first_name LIKE ?
       ORDER BY last_name, first_name
       LIMIT ${MAX_RESULTS}`,
    )
    .all(like, like) as RosterPlayerRow[];
  res.json(rows.map(toRosterPlayer));
});

export default router;
