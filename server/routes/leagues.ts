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
 * Renombra una liga, para corregir un error de tipeo. Los torneos la referencian por
 * tournaments.league_id, así que alcanza con esta fila: todas las vistas leen el nombre
 * por JOIN. No deja usar el nombre de OTRA liga (sin distinguir mayúsculas) porque dos
 * ligas iguales ya partieron un campeonato en dos una vez (ver POST /leagues); corregir
 * mayúsculas de la misma liga ("kohl" -> "Kohl") sí se puede.
 */
router.patch("/leagues/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT id FROM leagues WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "no se encontró esa liga" });

  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "el nombre de la liga es obligatorio" });
  }
  const newName = name.trim();

  const others = db
    .prepare("SELECT name FROM leagues WHERE id != ?")
    .all(req.params.id) as Array<{ name: string }>;
  if (others.some((l) => l.name.toLowerCase() === newName.toLowerCase())) {
    return res.status(409).json({ error: "ya existe otra liga con ese nombre" });
  }

  db.prepare("UPDATE leagues SET name = ? WHERE id = ?").run(newName, req.params.id);
  const updated = db.prepare("SELECT * FROM leagues WHERE id = ?").get(req.params.id) as LeagueRow;
  res.json(toLeague(updated));
});

/**
 * Borra una liga. Solo si ningún torneo la referencia (activo o en la papelera): la
 * columna tournaments.league_id tiene REFERENCES leagues(id) con foreign_keys ON, así
 * que borrar una liga todavía en uso rompería esa restricción a nivel de SQLite (un
 * torneo en la papelera igual sigue apuntando a la fila, por eso no se filtra por
 * deleted_at acá). El organizador tiene que cambiar la liga de esos torneos primero.
 */
router.delete("/leagues/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT id FROM leagues WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "no se encontró esa liga" });

  const enUso = db.prepare("SELECT 1 FROM tournaments WHERE league_id = ? LIMIT 1").get(req.params.id);
  if (enUso) {
    return res.status(409).json({
      error: "no se puede eliminar una liga con torneos asociados; cambiá la liga de esos torneos primero",
    });
  }

  db.prepare("DELETE FROM leagues WHERE id = ?").run(req.params.id);
  res.status(204).end();
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
