import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db";
import { formatPlayerName, type StandingsRow, type Tournament } from "../../shared/types";
import { computeStandings, type MatchOutcome } from "../scoring/tiebreaks";
import { requireAuth } from "../middleware/auth";

const router = Router();

const MAX_ROUNDS = 30;

interface TournamentRow {
  id: string;
  name: string;
  date: string;
  num_rounds: number;
  status: string;
  deleted_at: string | null;
  league_id: string | null;
  league_name: string | null;
}

function toTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    numRounds: row.num_rounds,
    status: row.status as Tournament["status"],
    deletedAt: row.deleted_at,
    leagueId: row.league_id,
    leagueName: row.league_name,
  };
}

// Trae league_name junto con el torneo para no tener que pedir la lista de ligas
// aparte solo para mostrar el nombre (ver TournamentList.tsx).
const TOURNAMENT_SELECT =
  "SELECT t.*, l.name AS league_name FROM tournaments t LEFT JOIN leagues l ON l.id = t.league_id";

/**
 * Resuelve a qué liga queda enganchado un torneo a partir del body de POST/PATCH
 * /tournaments: leagueId reusa una liga existente (404 si no existe), leagueName
 * crea una liga nueva con ese nombre. Deliberadamente no busca por nombre para
 * reusar una liga existente sin que el organizador la elija a propósito -- mismo
 * motivo que en server/routes/players.ts con el padrón de jugadores.
 */
function resolveLeagueId(
  body: Record<string, unknown>,
): { ok: true; leagueId: string | null } | { ok: false; error: string } {
  const { leagueId, leagueName } = body;
  if (typeof leagueId === "string" && leagueId) {
    const row = db.prepare("SELECT id FROM leagues WHERE id = ?").get(leagueId);
    if (!row) return { ok: false, error: "no se encontró esa liga" };
    return { ok: true, leagueId };
  }
  if (typeof leagueName === "string" && leagueName.trim()) {
    const id = nanoid();
    db.prepare("INSERT INTO leagues (id, name) VALUES (?, ?)").run(id, leagueName.trim());
    return { ok: true, leagueId: id };
  }
  return { ok: true, leagueId: null };
}

/**
 * Un torneo en la papelera se comporta como inexistente para todo el resto de la API:
 * no aparece en listados, ni en sus jugadores, rondas o posiciones. Solo la papelera
 * y la restauración lo ven.
 */
export function findActiveTournament(id: string | string[]): TournamentRow | undefined {
  return db
    .prepare(`${TOURNAMENT_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`)
    .get(id) as TournamentRow | undefined;
}

router.get("/tournaments", (_req, res) => {
  const rows = db
    .prepare(`${TOURNAMENT_SELECT} WHERE t.deleted_at IS NULL ORDER BY t.date DESC, t.name`)
    .all() as TournamentRow[];
  res.json(rows.map(toTournament));
});

/** Papelera: solo el organizador puede ver lo que se borró. */
router.get("/tournaments-papelera", requireAuth, (_req, res) => {
  const rows = db
    .prepare(`${TOURNAMENT_SELECT} WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC`)
    .all() as TournamentRow[];
  res.json(rows.map(toTournament));
});

router.post("/tournaments", requireAuth, (req, res) => {
  const { name, date, numRounds } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "el nombre es obligatorio" });
  }
  if (typeof date !== "string" || !date.trim()) {
    return res.status(400).json({ error: "la fecha es obligatoria" });
  }
  // MAX_ROUNDS coincide con el max del input en TournamentList.tsx: sin cota el
  // servidor aceptaba cualquier entero (ej. 999999999).
  const rounds = Number(numRounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) {
    return res.status(400).json({ error: `la cantidad de rondas debe ser un número entre 1 y ${MAX_ROUNDS}` });
  }
  const league = resolveLeagueId(req.body ?? {});
  if (!league.ok) return res.status(404).json({ error: league.error });
  const id = nanoid();
  db.prepare(
    "INSERT INTO tournaments (id, name, date, num_rounds, status, league_id) VALUES (?, ?, ?, ?, 'setup', ?)",
  ).run(id, name.trim(), date.trim(), rounds, league.leagueId);
  const row = db.prepare(`${TOURNAMENT_SELECT} WHERE t.id = ?`).get(id) as TournamentRow;
  res.status(201).json(toTournament(row));
});

router.get("/tournaments/:id", (req, res) => {
  const row = findActiveTournament(req.params.id);
  if (!row) return res.status(404).json({ error: "no se encontró el torneo" });
  res.json(toTournament(row));
});

/**
 * Único campo editable de un torneo por ahora: la liga del campeonato anual. Es
 * solo una etiqueta (no toca emparejamiento ni puntajes), así que se permite en
 * cualquier estado del torneo, incluso ya completado.
 */
router.patch("/tournaments/:id", requireAuth, (req, res) => {
  const row = findActiveTournament(req.params.id);
  if (!row) return res.status(404).json({ error: "no se encontró el torneo" });

  const { leagueId, leagueName } = req.body ?? {};
  if (leagueId === undefined && leagueName === undefined) {
    return res.status(400).json({ error: "falta el campo leagueId o leagueName" });
  }
  const league = resolveLeagueId(req.body ?? {});
  if (!league.ok) return res.status(404).json({ error: league.error });

  db.prepare("UPDATE tournaments SET league_id = ? WHERE id = ?").run(league.leagueId, req.params.id);
  const updated = db.prepare(`${TOURNAMENT_SELECT} WHERE t.id = ?`).get(req.params.id) as TournamentRow;
  res.json(toTournament(updated));
});

/**
 * Envía el torneo a la papelera. Se permite en cualquier estado, incluso en curso: si no,
 * un torneo de prueba ya arrancado quedaría imposible de limpiar. Es reversible, así que
 * un clic equivocado no destruye un evento entero.
 */
router.delete("/tournaments/:id", requireAuth, (req, res) => {
  const row = findActiveTournament(req.params.id);
  if (!row) return res.status(404).json({ error: "no se encontró el torneo" });
  db.prepare("UPDATE tournaments SET deleted_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    req.params.id,
  );
  res.status(204).end();
});

/** Saca el torneo de la papelera y lo devuelve tal como estaba. */
router.post("/tournaments/:id/restaurar", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT * FROM tournaments WHERE id = ? AND deleted_at IS NOT NULL")
    .get(req.params.id) as TournamentRow | undefined;
  if (!row) return res.status(404).json({ error: "no se encontró el torneo en la papelera" });
  db.prepare("UPDATE tournaments SET deleted_at = NULL WHERE id = ?").run(req.params.id);
  const restored = db
    .prepare(`${TOURNAMENT_SELECT} WHERE t.id = ?`)
    .get(req.params.id) as TournamentRow;
  res.json(toTournament(restored));
});

/**
 * Borrado definitivo: solo desde la papelera, para vaciarla. Exigir que el torneo ya esté
 * en la papelera obliga a dos acciones separadas antes de perder los datos de verdad.
 */
router.delete("/tournaments/:id/definitivo", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT id FROM tournaments WHERE id = ? AND deleted_at IS NOT NULL")
    .get(req.params.id) as { id: string } | undefined;
  if (!row) {
    return res.status(409).json({
      error: "solo se puede eliminar definitivamente un torneo que esté en la papelera",
    });
  }
  db.prepare("DELETE FROM tournaments WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

/**
 * Standings de un torneo a partir de sus rondas cerradas. Se exporta para que el
 * campeonato anual (server/routes/championship.ts) sume el mismo puntaje que ve el
 * organizador acá, en vez de recalcularlo con otra lógica.
 */
export function computeTournamentStandings(tournamentId: string): StandingsRow[] {
  const playerRows = db
    .prepare("SELECT id, last_name, first_name FROM players WHERE tournament_id = ?")
    .all(tournamentId) as Array<{ id: string; last_name: string; first_name: string }>;
  const players = playerRows.map((p) => ({
    id: p.id,
    name: formatPlayerName({ lastName: p.last_name, firstName: p.first_name }),
  }));

  const matches = db
    .prepare(
      `SELECT m.white_id, m.black_id, m.result
       FROM matches m
       JOIN rounds r ON r.id = m.round_id
       WHERE r.tournament_id = ? AND r.status = 'completed'`,
    )
    .all(tournamentId) as Array<{ white_id: string; black_id: string | null; result: string }>;

  const history = new Map<string, MatchOutcome[]>();
  const push = (playerId: string, outcome: MatchOutcome) => {
    if (!history.has(playerId)) history.set(playerId, []);
    history.get(playerId)!.push(outcome);
  };

  for (const m of matches) {
    if (m.black_id === null || m.result === "bye") {
      push(m.white_id, { opponentId: null, result: "bye" });
      continue;
    }
    if (m.result === "draw") {
      push(m.white_id, { opponentId: m.black_id, result: "draw" });
      push(m.black_id, { opponentId: m.white_id, result: "draw" });
    } else if (m.result === "white") {
      push(m.white_id, { opponentId: m.black_id, result: "win" });
      push(m.black_id, { opponentId: m.white_id, result: "loss" });
    } else if (m.result === "black") {
      push(m.white_id, { opponentId: m.black_id, result: "loss" });
      push(m.black_id, { opponentId: m.white_id, result: "win" });
    }
  }

  return computeStandings(players, history);
}

router.get("/tournaments/:id/standings", (req, res) => {
  const tournamentId = req.params.id;
  if (!findActiveTournament(tournamentId)) {
    return res.status(404).json({ error: "no se encontró el torneo" });
  }
  res.json(computeTournamentStandings(tournamentId));
});

export default router;
