import { Router } from "express";
import { db } from "../db";
import type { ChampionshipStandingsRow } from "../../shared/types";
import { computeTournamentStandings } from "./tournaments";

const router = Router();

/** Temporadas con al menos un torneo activo marcado, para el selector del frontend. */
router.get("/campeonato/temporadas", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT championship_season FROM tournaments
       WHERE championship_season IS NOT NULL AND deleted_at IS NULL
       ORDER BY championship_season DESC`,
    )
    .all() as Array<{ championship_season: string }>;
  res.json(rows.map((r) => r.championship_season));
});

/**
 * Suma directa del puntaje final que cada persona del padrón obtuvo en cada torneo
 * marcado con esta temporada (sin escala por posición, tal como se pidió). Reusa
 * computeTournamentStandings para no recalcular el puntaje con otra lógica que la
 * que ya ve el organizador en cada torneo.
 */
router.get("/campeonato", (req, res) => {
  const season = typeof req.query.season === "string" ? req.query.season : "";
  if (!season) return res.status(400).json({ error: "falta el parámetro season" });

  const tournaments = db
    .prepare("SELECT id FROM tournaments WHERE championship_season = ? AND deleted_at IS NULL")
    .all(season) as Array<{ id: string }>;

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
