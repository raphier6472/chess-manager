import { Router } from "express";
import { db } from "../db";
import type { League, RosterPlayer } from "../../shared/types";
import { requireAuth } from "../middleware/auth";

const router = Router();

const MAX_RESULTS = 15;

interface LeagueRow {
  id: string;
  name: string;
}

function toLeague(row: LeagueRow): League {
  return { id: row.id, name: row.name };
}

/**
 * Buscador para reutilizar o crear una liga al marcar un torneo (ver PATCH/POST
 * /tournaments en tournaments.ts). Mismo patrón que /roster: nombre libre, sin
 * auto-emparejar -- elegir una sugerencia es el único camino para reusar una liga
 * existente, tipear sin elegir crea una nueva.
 */
router.get("/leagues", requireAuth, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.json([]);

  const like = `%${q}%`;
  const rows = db
    .prepare(`SELECT * FROM leagues WHERE name LIKE ? ORDER BY name LIMIT ${MAX_RESULTS}`)
    .all(like) as LeagueRow[];
  res.json(rows.map(toLeague));
});

/**
 * Quiénes ya jugaron algún torneo de esta liga, sin importar cuál -- para preseleccionar
 * participantes al armar el próximo torneo de la misma liga y evitar tipear el nombre de
 * memoria cada vez (ver Players.tsx). Vacío en el primer torneo de una liga nueva.
 */
router.get("/leagues/:id/participantes", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT rp.id, rp.last_name, rp.first_name
       FROM roster_players rp
       JOIN players p ON p.roster_player_id = rp.id
       JOIN tournaments t ON t.id = p.tournament_id
       WHERE t.league_id = ? AND t.deleted_at IS NULL
       ORDER BY rp.last_name, rp.first_name`,
    )
    .all(req.params.id) as Array<{ id: string; last_name: string; first_name: string }>;
  const result: RosterPlayer[] = rows.map((r) => ({
    id: r.id,
    lastName: r.last_name,
    firstName: r.first_name,
  }));
  res.json(result);
});

export default router;
