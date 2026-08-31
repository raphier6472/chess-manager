import { Router } from "express";
import { db } from "../db";
import type { ChampionshipStandingsRow, League } from "../../shared/types";
import { computeTournamentStandings } from "./tournaments";

const router = Router();

/** Ligas con al menos un torneo activo marcado, para el selector del frontend. */
router.get("/ligas", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT l.id, l.name FROM leagues l
       JOIN tournaments t ON t.league_id = l.id
       WHERE t.deleted_at IS NULL
       ORDER BY l.name`,
    )
    .all() as League[];
  res.json(rows);
});

/**
 * Suma directa del puntaje final que cada persona del padrón obtuvo en cada torneo
 * marcado con esta liga (sin escala por posición, tal como se pidió). Reusa
 * computeTournamentStandings para no recalcular el puntaje con otra lógica que la
 * que ya ve el organizador en cada torneo.
 */
router.get("/campeonato", (req, res) => {
  const leagueId = typeof req.query.leagueId === "string" ? req.query.leagueId : "";
  if (!leagueId) return res.status(400).json({ error: "falta el parámetro leagueId" });

  const tournaments = db
    .prepare("SELECT id FROM tournaments WHERE league_id = ? AND deleted_at IS NULL")
    .all(leagueId) as Array<{ id: string }>;

  const totals = new Map<string, { name: string; totalScore: number; tournamentsPlayed: number }>();

  for (const t of tournaments) {
    const standings = computeTournamentStandings(t.id);
    const playerRows = db
      .prepare("SELECT id, roster_player_id FROM players WHERE tournament_id = ?")
      .all(t.id) as Array<{ id: string; roster_player_id: string }>;
    const rosterIdByPlayerId = new Map(playerRows.map((p) => [p.id, p.roster_player_id]));

    for (const row of standings) {
      const rosterId = rosterIdByPlayerId.get(row.playerId);
      if (!rosterId) continue;
      const existing = totals.get(rosterId);
      if (existing) {
        existing.totalScore += row.score;
        existing.tournamentsPlayed += 1;
      } else {
        totals.set(rosterId, { name: row.name, totalScore: row.score, tournamentsPlayed: 1 });
      }
    }
  }

  const result: ChampionshipStandingsRow[] = [...totals.entries()]
    .map(([rosterPlayerId, v]) => ({ rosterPlayerId, ...v }))
    .sort((a, b) => b.totalScore - a.totalScore || a.name.localeCompare(b.name));

  res.json(result);
});

export default router;
