import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db";
import { formatPlayerName, type Tournament } from "../../shared/types";
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
}

function toTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    numRounds: row.num_rounds,
    status: row.status as Tournament["status"],
    deletedAt: row.deleted_at,
  };
}

/**
 * Un torneo en la papelera se comporta como inexistente para todo el resto de la API:
 * no aparece en listados, ni en sus jugadores, rondas o posiciones. Solo la papelera
 * y la restauración lo ven.
 */
export function findActiveTournament(id: string): TournamentRow | undefined {
  return db
    .prepare("SELECT * FROM tournaments WHERE id = ? AND deleted_at IS NULL")
    .get(id) as TournamentRow | undefined;
}

router.get("/tournaments", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM tournaments WHERE deleted_at IS NULL ORDER BY date DESC, name")
    .all() as TournamentRow[];
  res.json(rows.map(toTournament));
});

/** Papelera: solo el organizador puede ver lo que se borró. */
router.get("/tournaments-papelera", requireAuth, (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM tournaments WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
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
  const id = nanoid();
  db.prepare(
    "INSERT INTO tournaments (id, name, date, num_rounds, status) VALUES (?, ?, ?, ?, 'setup')",
  ).run(id, name.trim(), date.trim(), rounds);
  const row = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id) as TournamentRow;
  res.status(201).json(toTournament(row));
});

router.get("/tournaments/:id", (req, res) => {
  const row = findActiveTournament(req.params.id);
  if (!row) return res.status(404).json({ error: "no se encontró el torneo" });
  res.json(toTournament(row));
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
  const restored = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id) as TournamentRow;
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

router.get("/tournaments/:id/standings", (req, res) => {
  const tournamentId = req.params.id;
  if (!findActiveTournament(tournamentId)) {
    return res.status(404).json({ error: "no se encontró el torneo" });
  }

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

  res.json(computeStandings(players, history));
});

export default router;
