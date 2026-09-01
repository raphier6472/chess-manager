import { Router } from "express";
import { db } from "../db";
import type { ChampionshipBoard, ChampionshipRow, ChampionshipTournamentSummary, LeagueSummary } from "../../shared/types";
import { computeTournamentStandings } from "./tournaments";

const router = Router();

/** Ligas con al menos un torneo activo marcado, para la lista de archivo del frontend. */
router.get("/ligas", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT l.id, l.name, COUNT(t.id) AS tournamentCount
       FROM leagues l
       JOIN tournaments t ON t.league_id = l.id AND t.deleted_at IS NULL
       GROUP BY l.id
       ORDER BY l.name`,
    )
    .all() as LeagueSummary[];
  res.json(rows);
});

interface TournamentSummaryRow {
  id: string;
  name: string;
  date: string;
  num_rounds: number;
  status: string;
}

/**
 * Dashboard completo de una liga: sus torneos (en orden cronológico, mismo orden que
 * usan las columnas de la tabla) y la tabla acumulada. Reusa computeTournamentStandings
 * para no recalcular el puntaje con otra lógica que la que ya ve el organizador en cada
 * torneo -- y, como esa lista ya viene ordenada por posición, el índice 0 de cada torneo
 * es quien salió 1º, que es lo que alimenta el desempate por "más primeros puestos".
 */
router.get("/campeonato", (req, res) => {
  const leagueId = typeof req.query.leagueId === "string" ? req.query.leagueId : "";
  if (!leagueId) return res.status(400).json({ error: "falta el parámetro leagueId" });

  const league = db.prepare("SELECT id, name FROM leagues WHERE id = ?").get(leagueId) as
    | { id: string; name: string }
    | undefined;
  if (!league) return res.status(404).json({ error: "no se encontró esa liga" });

  const tournamentRows = db
    .prepare(
      `SELECT id, name, date, num_rounds, status FROM tournaments
       WHERE league_id = ? AND deleted_at IS NULL
       ORDER BY date ASC, name ASC`,
    )
    .all(leagueId) as TournamentSummaryRow[];

  const tournaments: ChampionshipTournamentSummary[] = tournamentRows.map((t) => ({
    id: t.id,
    name: t.name,
    date: t.date,
    numRounds: t.num_rounds,
    status: t.status as ChampionshipTournamentSummary["status"],
  }));

  const totals = new Map<
    string,
    { name: string; scores: Map<string, number>; tournamentsPlayed: number; firstPlaceFinishes: number }
  >();

  for (const t of tournamentRows) {
    const standings = computeTournamentStandings(t.id);
    const playerRows = db
      .prepare("SELECT id, roster_player_id FROM players WHERE tournament_id = ?")
      .all(t.id) as Array<{ id: string; roster_player_id: string }>;
    const rosterIdByPlayerId = new Map(playerRows.map((p) => [p.id, p.roster_player_id]));

    standings.forEach((row, index) => {
      const rosterId = rosterIdByPlayerId.get(row.playerId);
      if (!rosterId) return;
      let entry = totals.get(rosterId);
      if (!entry) {
        entry = { name: row.name, scores: new Map(), tournamentsPlayed: 0, firstPlaceFinishes: 0 };
        totals.set(rosterId, entry);
      }
      entry.scores.set(t.id, row.score);
      entry.tournamentsPlayed += 1;
      if (index === 0) entry.firstPlaceFinishes += 1;
    });
  }

  const rows: ChampionshipRow[] = [...totals.entries()]
    .map(([rosterPlayerId, v]) => ({
      rosterPlayerId,
      name: v.name,
      scores: Object.fromEntries(v.scores),
      totalScore: [...v.scores.values()].reduce((sum, s) => sum + s, 0),
      tournamentsPlayed: v.tournamentsPlayed,
      firstPlaceFinishes: v.firstPlaceFinishes,
    }))
    .sort(
      (a, b) =>
        b.totalScore - a.totalScore ||
        b.tournamentsPlayed - a.tournamentsPlayed ||
        b.firstPlaceFinishes - a.firstPlaceFinishes ||
        a.name.localeCompare(b.name),
    );

  const board: ChampionshipBoard = { leagueId: league.id, leagueName: league.name, tournaments, rows };
  res.json(board);
});

export default router;
