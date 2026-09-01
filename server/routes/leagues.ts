import { Router } from "express";
import { nanoid } from "nanoid";
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
 * Sin `q`: todas las ligas (para el selector de "marcar liga" en TournamentList.tsx --
 * son pocas, no hace falta tipear para verlas). Con `q`: filtra por nombre.
 */
router.get("/leagues", requireAuth, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rows = q
    ? (db
        .prepare(`SELECT * FROM leagues WHERE name LIKE ? ORDER BY name LIMIT ${MAX_RESULTS}`)
        .all(`%${q}%`) as LeagueRow[])
    : (db.prepare("SELECT * FROM leagues ORDER BY name").all() as LeagueRow[]);
  res.json(rows.map(toLeague));
});

/**
 * Único camino para crear una liga: una acción explícita y separada de marcar un
 * torneo. Antes, marcar un torneo con un nombre que no coincidía con ninguna
 * sugerencia creaba una liga nueva en silencio -- en el uso real esto produjo dos
 * ligas "Khol 2026" distintas, partiendo el campeonato en dos sin que nadie lo
 * pidiera. Ahora `POST /tournaments` y `PATCH /tournaments/:id` solo aceptan
 * `leagueId` de una liga que ya existe (ver server/routes/tournaments.ts).
 */
router.post("/leagues", requireAuth, (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "el nombre de la liga es obligatorio" });
  }
  const id = nanoid();
  db.prepare("INSERT INTO leagues (id, name) VALUES (?, ?)").run(id, name.trim());
  const row = db.prepare("SELECT * FROM leagues WHERE id = ?").get(id) as LeagueRow;
  res.status(201).json(toLeague(row));
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
