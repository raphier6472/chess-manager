import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

const PASSWORD = "test-password-not-a-real-secret";

let app: Express;

beforeAll(async () => {
  // Base en memoria: server/db.ts respeta DB_PATH, así que los tests no tocan disco.
  // Hay que setear el entorno ANTES de importar la app, porque db.ts abre la conexión
  // y app.ts lee las variables al construirse.
  process.env.DB_PATH = ":memory:";
  process.env.SESSION_COOKIE_SECRET = "test-cookie-secret-0123456789abcdef";
  const { hashPassword } = await import("../auth/password");
  process.env.ORGANIZER_PASSWORD_HASH = hashPassword(PASSWORD);
  const { createApp } = await import("../app");
  app = createApp();
});

// El rate-limit del login usa CF-Connecting-IP como clave. Dándole a cada test una IP
// distinta, cada uno arranca con su propia cuota: sin esto los tests comparten el bucket
// y a partir del sexto login la suite empezaría a fallar con 429.
let clientSeq = 0;
function nextClientIp() {
  clientSeq += 1;
  return `203.0.113.${clientSeq}`;
}

/** Agente logueado como organizador (mantiene la cookie de sesión entre requests). */
async function organizer() {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/login")
    .set("CF-Connecting-IP", nextClientIp())
    .send({ password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

/** Torneo de 1 ronda con 2 jugadores, listo para emparejar. */
async function seedTournament(agent: ReturnType<typeof request.agent>, name: string) {
  const t = await agent.post("/api/tournaments").send({ name, date: "2026-08-26", numRounds: 1 });
  expect(t.status).toBe(201);
  const tournamentId = t.body.id as string;
  for (const lastName of ["Alfa", "Beta"]) {
    const p = await agent.post(`/api/tournaments/${tournamentId}/players`).send({ lastName });
    expect(p.status).toBe(201);
  }
  return tournamentId;
}

describe("eliminar torneo", () => {
  it("se puede enviar a la papelera en cualquier estado, incluso en curso", async () => {
    const agent = await organizer();

    // sin empezar
    const setupId = await seedTournament(agent, "Del sin empezar");
    expect((await agent.delete(`/api/tournaments/${setupId}`)).status).toBe(204);
    expect((await request(app).get(`/api/tournaments/${setupId}`)).status).toBe(404);

    // en curso: antes devolvía 409 y dejaba el torneo imposible de limpiar
    const activeId = await seedTournament(agent, "Del en curso");
    await agent.post(`/api/tournaments/${activeId}/rounds/generate`);
    expect((await request(app).get(`/api/tournaments/${activeId}`)).body.status).toBe("active");
    expect((await agent.delete(`/api/tournaments/${activeId}`)).status).toBe(204);
    expect((await request(app).get(`/api/tournaments/${activeId}`)).status).toBe(404);

    // terminado
    const doneId = await seedTournament(agent, "Del terminado");
    const rnd = await agent.post(`/api/tournaments/${doneId}/rounds/generate`);
    for (const m of rnd.body.matches) {
      if (m.blackId) await agent.post(`/api/matches/${m.id}/result`).send({ result: "white" });
    }
    await agent.post(`/api/rounds/${rnd.body.id}/complete`);
    expect((await agent.delete(`/api/tournaments/${doneId}`)).status).toBe(204);
    expect((await request(app).get(`/api/tournaments/${doneId}`)).status).toBe(404);
  });

  it("un torneo en la papelera queda invisible para toda la API pública", async () => {
    const agent = await organizer();
    const tid = await seedTournament(agent, "Papelera oculta");
    await agent.post(`/api/tournaments/${tid}/rounds/generate`);

    expect((await request(app).get(`/api/tournaments/${tid}/players`)).body.length).toBeGreaterThan(0);

    await agent.delete(`/api/tournaments/${tid}`);

    // No debe filtrarse por ninguna vía lateral aunque se conozca el id.
    for (const ruta of ["", "/players", "/rounds", "/standings"]) {
      expect((await request(app).get(`/api/tournaments/${tid}${ruta}`)).status).toBe(404);
    }
    const listado = await request(app).get("/api/tournaments");
    expect(listado.body.some((t: { id: string }) => t.id === tid)).toBe(false);
  });

  it("restaura un torneo de la papelera con sus datos intactos", async () => {
    const agent = await organizer();
    const tid = await seedTournament(agent, "Para restaurar");
    const rnd = await agent.post(`/api/tournaments/${tid}/rounds/generate`);
    await agent.post(`/api/matches/${rnd.body.matches[0].id}/result`).send({ result: "white" });
    const antes = await request(app).get(`/api/tournaments/${tid}/standings`);

    await agent.delete(`/api/tournaments/${tid}`);
    const papelera = await agent.get("/api/tournaments-papelera");
    expect(papelera.body.some((t: { id: string }) => t.id === tid)).toBe(true);

    expect((await agent.post(`/api/tournaments/${tid}/restaurar`)).status).toBe(200);

    const vivo = await request(app).get(`/api/tournaments/${tid}`);
    expect(vivo.status).toBe(200);
    expect(vivo.body.deletedAt).toBeNull();
    // Los resultados que ya estaban cargados siguen ahí.
    const despues = await request(app).get(`/api/tournaments/${tid}/standings`);
    expect(despues.body).toEqual(antes.body);
  });

  it("la papelera es privada y el borrado definitivo exige pasar por ella", async () => {
    const agent = await organizer();
    const tid = await seedTournament(agent, "Definitivo");

    expect((await request(app).get("/api/tournaments-papelera")).status).toBe(401);
    expect((await request(app).delete(`/api/tournaments/${tid}/definitivo`)).status).toBe(401);

    // Un torneo activo no se puede borrar para siempre de un solo paso.
    expect((await agent.delete(`/api/tournaments/${tid}/definitivo`)).status).toBe(409);

    await agent.delete(`/api/tournaments/${tid}`);
    expect((await agent.delete(`/api/tournaments/${tid}/definitivo`)).status).toBe(204);

    // Ahora sí desapareció, también de la papelera.
    const papelera = await agent.get("/api/tournaments-papelera");
    expect(papelera.body.some((t: { id: string }) => t.id === tid)).toBe(false);
    expect((await agent.post(`/api/tournaments/${tid}/restaurar`)).status).toBe(404);
  });
});

describe("autorización", () => {
  it("rechaza escrituras sin sesión", async () => {
    const anon = request(app);
    expect((await anon.post("/api/tournaments").send({ name: "X", date: "2026-08-26", numRounds: 1 })).status).toBe(401);
    expect((await anon.delete("/api/tournaments/whatever")).status).toBe(401);
    expect((await anon.post("/api/matches/whatever/result").send({ result: "white" })).status).toBe(401);
  });
});

describe("resultados de una ronda cerrada", () => {
  it("no deja cambiar el resultado una vez cerrada la ronda, y las posiciones no se alteran", async () => {
    const agent = await organizer();
    const tournamentId = await seedTournament(agent, "Regresión ronda cerrada");

    const round = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    expect(round.status).toBe(201);
    const matchId = round.body.matches[0].id as string;
    const roundId = round.body.id as string;

    expect((await agent.post(`/api/matches/${matchId}/result`).send({ result: "white" })).status).toBe(200);
    expect((await agent.post(`/api/rounds/${roundId}/complete`)).status).toBe(200);

    const before = await request(app).get(`/api/tournaments/${tournamentId}/standings`);
    expect(before.body[0].name).toBe("Alfa");
    expect(before.body[0].score).toBe(1);

    // El fallo original: esto devolvía 200 y daba vuelta el podio de un torneo terminado.
    const flip = await agent.post(`/api/matches/${matchId}/result`).send({ result: "black" });
    expect(flip.status).toBe(409);

    const after = await request(app).get(`/api/tournaments/${tournamentId}/standings`);
    expect(after.body[0].name).toBe("Alfa");
    expect(after.body[0].score).toBe(1);
  });

  it("no deja re-cerrar una ronda ya cerrada", async () => {
    const agent = await organizer();
    const tournamentId = await seedTournament(agent, "Re-cierre");

    const round = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    const matchId = round.body.matches[0].id as string;
    const roundId = round.body.id as string;

    await agent.post(`/api/matches/${matchId}/result`).send({ result: "white" });
    expect((await agent.post(`/api/rounds/${roundId}/complete`)).status).toBe(200);
    expect((await agent.post(`/api/rounds/${roundId}/complete`)).status).toBe(409);
  });
});

describe("reabrir ronda", () => {
  it("permite corregir un resultado de la última ronda cerrada y volver a cerrarla", async () => {
    const agent = await organizer();
    const tid = await seedTournament(agent, "Reabrir");
    const rnd = await agent.post(`/api/tournaments/${tid}/rounds/generate`);
    const roundId = rnd.body.id as string;
    const matchId = rnd.body.matches[0].id as string;

    await agent.post(`/api/matches/${matchId}/result`).send({ result: "white" });
    await agent.post(`/api/rounds/${roundId}/complete`);
    expect((await request(app).get(`/api/tournaments/${tid}`)).body.status).toBe("completed");

    // Con la ronda cerrada el resultado está bloqueado...
    expect((await agent.post(`/api/matches/${matchId}/result`).send({ result: "black" })).status).toBe(409);

    // ...hasta que se reabre. El torneo vuelve a estar en curso.
    expect((await agent.post(`/api/rounds/${roundId}/reopen`)).status).toBe(200);
    expect((await request(app).get(`/api/tournaments/${tid}`)).body.status).toBe("active");

    expect((await agent.post(`/api/matches/${matchId}/result`).send({ result: "black" })).status).toBe(200);
    expect((await agent.post(`/api/rounds/${roundId}/complete`)).status).toBe(200);

    const standings = await request(app).get(`/api/tournaments/${tid}/standings`);
    expect(standings.body[0].score).toBe(1);
    expect(standings.body[0].name).toBe("Beta");
  });

  it("no deja reabrir una ronda si ya se emparejó la siguiente", async () => {
    const agent = await organizer();
    const t = await agent.post("/api/tournaments").send({ name: "Reabrir vieja", date: "2026-08-26", numRounds: 2 });
    const tid = t.body.id as string;
    for (const lastName of ["Alfa", "Beta"]) {
      await agent.post(`/api/tournaments/${tid}/players`).send({ lastName });
    }
    const r1 = await agent.post(`/api/tournaments/${tid}/rounds/generate`);
    await agent.post(`/api/matches/${r1.body.matches[0].id}/result`).send({ result: "white" });
    await agent.post(`/api/rounds/${r1.body.id}/complete`);
    await agent.post(`/api/tournaments/${tid}/rounds/generate`);

    const res = await agent.post(`/api/rounds/${r1.body.id}/reopen`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("última ronda");
  });

  it("no deja reabrir una ronda que sigue abierta", async () => {
    const agent = await organizer();
    const tid = await seedTournament(agent, "Reabrir abierta");
    const rnd = await agent.post(`/api/tournaments/${tid}/rounds/generate`);
    expect((await agent.post(`/api/rounds/${rnd.body.id}/reopen`)).status).toBe(409);
  });
});

describe("mensajes al organizador", () => {
  it("están en español", async () => {
    const agent = await organizer();
    const tid = await seedTournament(agent, "Mensajes");

    const sinApellido = await agent.post(`/api/tournaments/${tid}/players`).send({ lastName: "" });
    expect(sinApellido.body.error).toBe("el apellido es obligatorio");

    const noExiste = await request(app).get("/api/tournaments/noexiste");
    expect(noExiste.body.error).toBe("no se encontró el torneo");

    // Torneo de 2 rondas: así el segundo "emparejar" choca con la ronda abierta y no
    // con el tope de rondas del torneo.
    const t2 = await agent
      .post("/api/tournaments")
      .send({ name: "Mensajes 2", date: "2026-08-26", numRounds: 2 });
    const t2id = t2.body.id as string;
    for (const lastName of ["Alfa", "Beta"]) {
      await agent.post(`/api/tournaments/${t2id}/players`).send({ lastName });
    }
    const rnd = await agent.post(`/api/tournaments/${t2id}/rounds/generate`);

    const sinCerrar = await agent.post(`/api/tournaments/${t2id}/rounds/generate`);
    expect(sinCerrar.body.error).toBe("primero tienes que cerrar la ronda anterior");

    const faltanResultados = await agent.post(`/api/rounds/${rnd.body.id}/complete`);
    expect(faltanResultados.body.error).toBe("carga el resultado de todas las mesas antes de cerrar la ronda");
  });
});

describe("validación de entrada", () => {
  it("acota numRounds", async () => {
    const agent = await organizer();
    const base = { name: "Cota", date: "2026-08-26" };
    expect((await agent.post("/api/tournaments").send({ ...base, numRounds: 999999999 })).status).toBe(400);
    expect((await agent.post("/api/tournaments").send({ ...base, numRounds: 0 })).status).toBe(400);
    expect((await agent.post("/api/tournaments").send({ ...base, numRounds: 30 })).status).toBe(201);
  });

  it("exige que el rating sea un entero en rango", async () => {
    const agent = await organizer();
    const tournamentId = await seedTournament(agent, "Rating");
    const url = `/api/tournaments/${tournamentId}/players`;

    expect((await agent.post(url).send({ lastName: "Malo", rating: -9999.5 })).status).toBe(400);
    expect((await agent.post(url).send({ lastName: "Malo", rating: 99999 })).status).toBe(400);
    expect((await agent.post(url).send({ lastName: "Malo", rating: 1500.7 })).status).toBe(400);

    const ok = await agent.post(url).send({ lastName: "Bueno", rating: 1500 });
    expect(ok.status).toBe(201);
    expect(ok.body.rating).toBe(1500);

    // Sin Elo sigue siendo válido (queda null).
    const sinElo = await agent.post(url).send({ lastName: "SinElo" });
    expect(sinElo.status).toBe(201);
    expect(sinElo.body.rating).toBeNull();

    // Un PATCH con rating inválido no debe aplicar los otros campos.
    const bad = await agent.patch(`/api/players/${ok.body.id}`).send({ lastName: "Cambiado", rating: -5 });
    expect(bad.status).toBe(400);
    const after = await request(app).get(url);
    expect(after.body.some((p: { lastName: string }) => p.lastName === "Cambiado")).toBe(false);
  });
});

describe("GET /auth/me", () => {
  it("incluye organizerName solo con sesión activa, y solo si ORGANIZER_NAME está seteada", async () => {
    const anon = await request(app).get("/api/auth/me");
    expect(anon.body).toEqual({ authenticated: false, organizerName: null });

    const agent = await organizer();

    const withoutName = await agent.get("/api/auth/me");
    expect(withoutName.body).toEqual({ authenticated: true, organizerName: null });

    process.env.ORGANIZER_NAME = "Pablo";
    try {
      const withName = await agent.get("/api/auth/me");
      expect(withName.body).toEqual({ authenticated: true, organizerName: "Pablo" });
    } finally {
      delete process.env.ORGANIZER_NAME;
    }
  });
});

describe("rate-limit del login", () => {
  it("no se evade rotando X-Forwarded-For", async () => {
    // Regresión: con `trust proxy: "loopback"` Express tomaba el IP del XFF que manda
    // el propio cliente, así que cada intento caía en un bucket distinto y el límite
    // era inútil. Sin CF-Connecting-IP todo debe caer en un único bucket compartido.
    const codes: number[] = [];
    for (let i = 1; i <= 8; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `9.9.9.${i}`)
        .send({ password: "wrong" });
      codes.push(res.status);
    }
    expect(codes).toContain(429);
  });

  it("separa la cuota por cliente real vía CF-Connecting-IP", async () => {
    const spent = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("CF-Connecting-IP", "198.51.100.1")
        .send({ password: "wrong" });
      spent.push(res.status);
    }
    expect(spent).toContain(429);

    // Otro cliente no queda bloqueado por la cuota del primero.
    const other = await request(app)
      .post("/api/auth/login")
      .set("CF-Connecting-IP", "198.51.100.2")
      .send({ password: "wrong" });
    expect(other.status).toBe(401);
  });
});

describe("borrar jugadores", () => {
  it("deja borrar a un jugador agregado después de emparejar la ronda 1, mientras no tenga partidas", async () => {
    // Reporte real de un torneo en curso: un jugador cargado por error después de
    // emparejar la ronda 1 quedaba atrapado sin poder sacarlo (antes el bloqueo era por
    // estado del torneo, no por si ese jugador en particular había jugado algo).
    const agent = await organizer();
    const tournamentId = await seedTournament(agent, "Borrar tras emparejar");
    await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);

    const tarde = await agent
      .post(`/api/tournaments/${tournamentId}/players`)
      .send({ lastName: "Tarde" });
    expect(tarde.status).toBe(201);

    expect((await agent.delete(`/api/players/${tarde.body.id}`)).status).toBe(204);
    const jugadores = await request(app).get(`/api/tournaments/${tournamentId}/players`);
    expect(jugadores.body.some((p: { id: string }) => p.id === tarde.body.id)).toBe(false);
  });

  it("no deja borrar a un jugador que ya tiene partidas, aunque esté en curso", async () => {
    const agent = await organizer();
    const tournamentId = await seedTournament(agent, "No borrar con partidas");
    const round = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    const whiteId = round.body.matches[0].whiteId as string;

    const res = await agent.delete(`/api/players/${whiteId}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("retíralo en su lugar");
  });
});

describe("rutas /api no reconocidas", () => {
  it("devuelve 404 JSON en vez de caer en el catch-all de la SPA", async () => {
    // Regresión: el catch-all app.get(/.*/, ...) para servir la SPA en producción
    // matcheaba también /api/* sin ruta, devolviendo 200 con el HTML de index.html.
    const res = await request(app).get("/api/esto-no-existe");
    expect(res.status).toBe(404);
    expect(res.type).toBe("application/json");
  });
});

describe("índice único de rondas", () => {
  it("la base rechaza dos rondas con el mismo número para el mismo torneo", async () => {
    // Defensa en profundidad: hoy el servidor es síncrono y de un solo proceso, así que
    // esto no es explotable vía HTTP (ver el 409 en rounds.ts), pero el esquema debe
    // impedirlo igual si algún día deja de serlo.
    const { db } = await import("../db");
    const agent = await organizer();
    const tournamentId = await seedTournament(agent, "Índice único");
    const round = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    expect(round.status).toBe(201);

    expect(() =>
      db
        .prepare("INSERT INTO rounds (id, tournament_id, number, status) VALUES (?, ?, ?, 'paired')")
        .run("otro-id-cualquiera", tournamentId, round.body.number),
    ).toThrow(/UNIQUE constraint failed/);
  });
});

describe("orden de mesas por Elo", () => {
  it("pone la pareja de mayor Elo en la mesa 1 entre parejas empatadas en puntaje", async () => {
    // Regresión: reportado en un torneo real. 8 jugadores, ratings muy separados; tras
    // la ronda 1 el grupo de 1 punto queda con dos parejas de Elo muy distinto (2000/900
    // vs 1000/1900 por las sorpresas de abajo). La mesa 1 de la ronda 2 debe quedar con
    // la pareja de mayor Elo (la del 2000), no con la que la consulta a la base devolviera
    // primero.
    const agent = await organizer();
    const t = await agent
      .post("/api/tournaments")
      .send({ name: "Orden de mesas", date: "2026-08-27", numRounds: 2 });
    const tournamentId = t.body.id as string;

    const ratings: Record<string, number> = {
      A: 2000, B: 1900, C: 1800, D: 1700, E: 1200, F: 1100, G: 1000, H: 900,
    };
    const ids: Record<string, string> = {};
    for (const [lastName, rating] of Object.entries(ratings)) {
      const p = await agent.post(`/api/tournaments/${tournamentId}/players`).send({ lastName, rating });
      ids[lastName] = p.body.id;
    }

    const r1 = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    expect(r1.status).toBe(201);
    // Fold seeding: mesa1 A-E, mesa2 F-B, mesa3 C-G, mesa4 H-D (ver generateInitialPairings).
    const byPlayers = (white: string, black: string) =>
      r1.body.matches.find((m: { whiteId: string; blackId: string }) => m.whiteId === white && m.blackId === black);

    // Ganan A (favorito), B (favorito, es negras acá), G (sorpresa) y H (sorpresa).
    await agent.post(`/api/matches/${byPlayers(ids.A, ids.E).id}/result`).send({ result: "white" });
    await agent.post(`/api/matches/${byPlayers(ids.F, ids.B).id}/result`).send({ result: "black" });
    await agent.post(`/api/matches/${byPlayers(ids.C, ids.G).id}/result`).send({ result: "black" });
    await agent.post(`/api/matches/${byPlayers(ids.H, ids.D).id}/result`).send({ result: "white" });
    await agent.post(`/api/rounds/${r1.body.id}/complete`);

    const r2 = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    expect(r2.status).toBe(201);
    // El grupo de 1 punto es {A2000, B1900, G1000, H900}: dos mesas posibles. La mesa 1
    // debe incluir al Elo más alto (A, 2000).
    const mesa1 = r2.body.matches[0];
    expect([mesa1.whiteId, mesa1.blackId]).toContain(ids.A);
  });
});

describe("bye manual", () => {
  it("saca al jugador elegido del emparejamiento de la ronda 1 y le da el bye", async () => {
    const agent = await organizer();
    const t = await agent
      .post("/api/tournaments")
      .send({ name: "Bye manual R1", date: "2026-08-27", numRounds: 2 });
    const tournamentId = t.body.id as string;
    const ids: string[] = [];
    for (const lastName of ["A", "B", "C", "D"]) {
      const p = await agent.post(`/api/tournaments/${tournamentId}/players`).send({ lastName });
      ids.push(p.body.id);
    }

    const r1 = await agent
      .post(`/api/tournaments/${tournamentId}/rounds/generate`)
      .send({ byePlayerIds: [ids[1]] });
    expect(r1.status).toBe(201);

    // B pidió el bye a propósito. Quedan A, C, D (impar): uno de ellos recibe el bye
    // automático y los otros dos forman una mesa. Total: 2 byes, 1 mesa.
    const byes = r1.body.matches.filter((m: { blackId: string | null }) => m.blackId === null);
    const boards = r1.body.matches.filter((m: { blackId: string | null }) => m.blackId !== null);
    expect(byes).toHaveLength(2);
    expect(boards).toHaveLength(1);
    expect(byes.map((m: { whiteId: string }) => m.whiteId)).toContain(ids[1]);
  });

  it("también funciona en rondas posteriores y rechaza un id que no es del torneo", async () => {
    const agent = await organizer();
    const t = await agent
      .post("/api/tournaments")
      .send({ name: "Bye manual R2", date: "2026-08-27", numRounds: 2 });
    const tournamentId = t.body.id as string;
    for (const lastName of ["Alfa", "Beta"]) {
      await agent.post(`/api/tournaments/${tournamentId}/players`).send({ lastName });
    }
    const jugadores = await request(app).get(`/api/tournaments/${tournamentId}/players`);
    const [p1, p2] = jugadores.body as Array<{ id: string }>;

    const invalido = await agent
      .post(`/api/tournaments/${tournamentId}/rounds/generate`)
      .send({ byePlayerIds: ["no-existe"] });
    expect(invalido.status).toBe(400);

    const r1 = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    await agent.post(`/api/matches/${r1.body.matches[0].id}/result`).send({ result: "white" });
    await agent.post(`/api/rounds/${r1.body.id}/complete`);

    // Con solo 2 jugadores activos, sacar a uno del emparejamiento deja al otro solo:
    // también recibe bye (automático), así que la ronda queda con 2 byes y 0 mesas.
    const r2 = await agent
      .post(`/api/tournaments/${tournamentId}/rounds/generate`)
      .send({ byePlayerIds: [p1.id] });
    expect(r2.status).toBe(201);
    expect(r2.body.matches).toHaveLength(2);
    expect(r2.body.matches.every((m: { blackId: string | null }) => m.blackId === null)).toBe(true);
    const byeWhoIds = r2.body.matches.map((m: { whiteId: string }) => m.whiteId);
    expect(byeWhoIds).toContain(p1.id);
    expect(byeWhoIds).toContain(p2.id);
  });
});

describe("forfeit / W.O.", () => {
  it("da el punto completo al presente y lo marca como forfeit", async () => {
    const agent = await organizer();
    const tournamentId = await seedTournament(agent, "Forfeit");
    const round = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    const matchId = round.body.matches[0].id as string;

    const res = await agent
      .post(`/api/matches/${matchId}/result`)
      .send({ result: "white", forfeit: true });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("white");
    expect(res.body.forfeit).toBe(true);

    // El puntaje cuenta igual que una victoria jugada.
    await agent.post(`/api/rounds/${round.body.id}/complete`);
    const standings = await request(app).get(`/api/tournaments/${tournamentId}/standings`);
    expect(standings.body[0].score).toBe(1);
  });

  it("no deja marcar tablas como forfeit", async () => {
    const agent = await organizer();
    const tournamentId = await seedTournament(agent, "Forfeit tablas");
    const round = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    const matchId = round.body.matches[0].id as string;

    const res = await agent
      .post(`/api/matches/${matchId}/result`)
      .send({ result: "draw", forfeit: true });
    expect(res.status).toBe(400);
  });
});

describe("padrón compartido", () => {
  it("reutiliza la misma identidad del padrón entre dos torneos", async () => {
    const agent = await organizer();
    const t1 = await agent
      .post("/api/tournaments")
      .send({ name: "Padrón A", date: "2026-01-01", numRounds: 1 });
    const p1 = await agent
      .post(`/api/tournaments/${t1.body.id}/players`)
      .send({ lastName: "Pérez", firstName: "Juan" });
    expect(p1.status).toBe(201);
    const rosterPlayerId = p1.body.rosterPlayerId as string;
    expect(rosterPlayerId).toBeTruthy();

    const t2 = await agent
      .post("/api/tournaments")
      .send({ name: "Padrón B", date: "2026-02-01", numRounds: 1 });
    const p2 = await agent.post(`/api/tournaments/${t2.body.id}/players`).send({ rosterPlayerId });
    expect(p2.status).toBe(201);
    expect(p2.body.rosterPlayerId).toBe(rosterPlayerId);
    expect(p2.body.lastName).toBe("Pérez");
    expect(p2.body.firstName).toBe("Juan");
  });

  it("sin rosterPlayerId, cada alta crea una identidad nueva en el padrón", async () => {
    const agent = await organizer();
    const t = await agent
      .post("/api/tournaments")
      .send({ name: "Padrón nuevo", date: "2026-01-01", numRounds: 1 });
    const p1 = await agent.post(`/api/tournaments/${t.body.id}/players`).send({ lastName: "Soto" });
    const p2 = await agent.post(`/api/tournaments/${t.body.id}/players`).send({ lastName: "Soto" });
    expect(p1.body.rosterPlayerId).not.toBe(p2.body.rosterPlayerId);
  });

  it("rechaza un rosterPlayerId que no existe", async () => {
    const agent = await organizer();
    const t = await agent
      .post("/api/tournaments")
      .send({ name: "Padrón inválido", date: "2026-01-01", numRounds: 1 });
    const res = await agent
      .post(`/api/tournaments/${t.body.id}/players`)
      .send({ rosterPlayerId: "no-existe" });
    expect(res.status).toBe(404);
  });

  it("GET /roster encuentra por apellido y exige sesión de organizador", async () => {
    const agent = await organizer();
    const t = await agent
      .post("/api/tournaments")
      .send({ name: "Buscador", date: "2026-01-01", numRounds: 1 });
    await agent.post(`/api/tournaments/${t.body.id}/players`).send({ lastName: "Gonzalez", firstName: "Ana" });

    const res = await agent.get("/api/roster?q=Gonz");
    expect(res.status).toBe(200);
    expect(res.body.some((r: { lastName: string }) => r.lastName === "Gonzalez")).toBe(true);

    expect((await request(app).get("/api/roster?q=Gonz")).status).toBe(401);
  });
});

describe("campeonato anual", () => {
  /** Crea una liga explícitamente (único camino posible desde la API). */
  async function createLeague(agent: ReturnType<typeof request.agent>, name: string) {
    const res = await agent.post("/api/leagues").send({ name });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  /** Torneo de 1 ronda con 2 jugadores donde uno gana, para controlar el puntaje final. */
  async function tournamentWithWinner(
    agent: ReturnType<typeof request.agent>,
    opts: {
      name: string;
      leagueId?: string;
      winner: { rosterPlayerId?: string; lastName?: string };
      result: "win" | "draw" | "loss";
    },
  ) {
    const t = await agent.post("/api/tournaments").send({
      name: opts.name,
      date: "2026-01-01",
      numRounds: 1,
      ...(opts.leagueId ? { leagueId: opts.leagueId } : {}),
    });
    expect(t.status).toBe(201);
    const tournamentId = t.body.id as string;

    const winner = await agent
      .post(`/api/tournaments/${tournamentId}/players`)
      .send(opts.winner.rosterPlayerId ? { rosterPlayerId: opts.winner.rosterPlayerId } : { lastName: opts.winner.lastName });
    expect(winner.status).toBe(201);
    const rival = await agent.post(`/api/tournaments/${tournamentId}/players`).send({ lastName: "Rival" });
    expect(rival.status).toBe(201);

    const round = await agent.post(`/api/tournaments/${tournamentId}/rounds/generate`);
    expect(round.status).toBe(201);
    const match = round.body.matches[0];
    const winnerIsWhite = match.whiteId === winner.body.id;
    let result: "white" | "black" | "draw";
    if (opts.result === "draw") {
      result = "draw";
    } else {
      const whiteWins = opts.result === "win" ? winnerIsWhite : !winnerIsWhite;
      result = whiteWins ? "white" : "black";
    }
    await agent.post(`/api/matches/${match.id}/result`).send({ result });
    await agent.post(`/api/rounds/${round.body.id}/complete`);

    return {
      tournamentId,
      leagueId: t.body.leagueId as string | null,
      rosterPlayerId: winner.body.rosterPlayerId as string,
    };
  }

  it("suma el puntaje final de la misma persona solo entre los torneos de esa liga", async () => {
    const agent = await organizer();
    const zephyrId = await createLeague(agent, "Liga Zephyr 2026");
    const otraId = await createLeague(agent, "Otra liga");

    const a = await tournamentWithWinner(agent, {
      name: "Circuito enero",
      leagueId: zephyrId,
      winner: { lastName: "Campeón" },
      result: "win",
    });
    // Reusa la misma liga por id en un segundo torneo.
    const b = await tournamentWithWinner(agent, {
      name: "Circuito marzo",
      leagueId: a.leagueId!,
      winner: { rosterPlayerId: a.rosterPlayerId },
      result: "draw",
    });
    // Mismo jugador, pero en otra liga: no debe sumar a la primera.
    const otra = await tournamentWithWinner(agent, {
      name: "Circuito paralelo",
      leagueId: otraId,
      winner: { rosterPlayerId: a.rosterPlayerId },
      result: "win",
    });
    // Torneo sin liga marcada: tampoco debe sumar a ningún campeonato.
    await tournamentWithWinner(agent, {
      name: "Amistoso suelto",
      winner: { rosterPlayerId: a.rosterPlayerId },
      result: "win",
    });

    const ligas = await request(app).get("/api/ligas");
    expect(ligas.status).toBe(200);
    expect(ligas.body.map((l: { name: string }) => l.name)).toEqual(
      expect.arrayContaining(["Liga Zephyr 2026", "Otra liga"]),
    );

    const resA = await request(app).get(`/api/campeonato?leagueId=${a.leagueId}`);
    expect(resA.status).toBe(200);
    const row = resA.body.find((r: { rosterPlayerId: string }) => r.rosterPlayerId === a.rosterPlayerId);
    expect(row.totalScore).toBe(1.5);
    expect(row.tournamentsPlayed).toBe(2);

    const resOtra = await request(app).get(`/api/campeonato?leagueId=${otra.leagueId}`);
    const rowOtra = resOtra.body.find((r: { rosterPlayerId: string }) => r.rosterPlayerId === a.rosterPlayerId);
    expect(rowOtra.totalScore).toBe(1);
    expect(rowOtra.tournamentsPlayed).toBe(1);

    expect(b.tournamentId).not.toBe(a.tournamentId);
    expect(b.leagueId).toBe(a.leagueId);
  });

  it("GET /campeonato sin leagueId devuelve 400", async () => {
    expect((await request(app).get("/api/campeonato")).status).toBe(400);
  });

  it("POST /tournaments rechaza un leagueId que no existe", async () => {
    const agent = await organizer();
    const res = await agent
      .post("/api/tournaments")
      .send({ name: "Liga inválida", date: "2026-01-01", numRounds: 1, leagueId: "no-existe" });
    expect(res.status).toBe(404);
  });

  it("regresión: mandar leagueName en vez de leagueId ya NO crea una liga (bug real de producción)", async () => {
    // Antes, escribir un nombre de liga que no coincidía exactamente con ninguna
    // sugerencia del buscador creaba una liga nueva en silencio -- en producción
    // esto terminó creando dos ligas "Khol 2026" separadas y partiendo el
    // campeonato en dos. Ahora la API solo entiende leagueId: leagueName ya no
    // existe como forma de asociar (ni de crear) una liga desde /tournaments.
    const agent = await organizer();
    const before = await request(app).get("/api/ligas");
    const countBefore = before.body.length;

    const res = await agent.post("/api/tournaments").send({
      name: "Circuito con leagueName suelto",
      date: "2026-01-01",
      numRounds: 1,
      leagueName: "Liga Fantasma",
    });
    expect(res.status).toBe(201);
    expect(res.body.leagueId).toBeNull();
    expect(res.body.leagueName).toBeNull();

    const after = await request(app).get("/api/ligas");
    expect(after.body.length).toBe(countBefore);
    expect(after.body.some((l: { name: string }) => l.name === "Liga Fantasma")).toBe(false);
  });
});

describe("marcar liga de un torneo", () => {
  it("PATCH /tournaments/:id asocia por leagueId y limpia con leagueId null", async () => {
    const agent = await organizer();
    const liga = await agent.post("/api/leagues").send({ name: "Liga Nueva" });
    expect(liga.status).toBe(201);
    const leagueId = liga.body.id as string;

    const t = await agent.post("/api/tournaments").send({ name: "Marcar liga", date: "2026-01-01", numRounds: 1 });

    const set = await agent.patch(`/api/tournaments/${t.body.id}`).send({ leagueId });
    expect(set.status).toBe(200);
    expect(set.body.leagueId).toBe(leagueId);
    expect(set.body.leagueName).toBe("Liga Nueva");

    const clear = await agent.patch(`/api/tournaments/${t.body.id}`).send({ leagueId: null });
    expect(clear.status).toBe(200);
    expect(clear.body.leagueId).toBeNull();
    expect(clear.body.leagueName).toBeNull();
  });

  it("rechaza un leagueId que no existe", async () => {
    const agent = await organizer();
    const t = await agent.post("/api/tournaments").send({ name: "Liga inexistente", date: "2026-01-01", numRounds: 1 });
    const res = await agent.patch(`/api/tournaments/${t.body.id}`).send({ leagueId: "no-existe" });
    expect(res.status).toBe(404);
  });

  it("400 si no manda leagueId", async () => {
    const agent = await organizer();
    const t = await agent.post("/api/tournaments").send({ name: "Liga sin campo", date: "2026-01-01", numRounds: 1 });
    const res = await agent.patch(`/api/tournaments/${t.body.id}`).send({});
    expect(res.status).toBe(400);
  });

  it("exige sesión de organizador", async () => {
    const agent = await organizer();
    const t = await agent.post("/api/tournaments").send({ name: "Liga sin sesión", date: "2026-01-01", numRounds: 1 });
    const res = await request(app).patch(`/api/tournaments/${t.body.id}`).send({ leagueId: null });
    expect(res.status).toBe(401);
  });
});

describe("POST /leagues", () => {
  it("crea una liga y exige sesión de organizador", async () => {
    const agent = await organizer();
    const res = await agent.post("/api/leagues").send({ name: "Liga Recreo" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Liga Recreo");
    expect(res.body.id).toBeTruthy();

    expect((await request(app).post("/api/leagues").send({ name: "Sin sesión" })).status).toBe(401);
  });

  it("rechaza un nombre vacío", async () => {
    const agent = await organizer();
    expect((await agent.post("/api/leagues").send({ name: "" })).status).toBe(400);
    expect((await agent.post("/api/leagues").send({})).status).toBe(400);
  });

  it("crear dos veces con el mismo nombre da dos ligas distintas (a propósito: el duplicado se evita en la interfaz -- eligiendo del selector -- no adivinando por nombre en el servidor)", async () => {
    const agent = await organizer();
    const first = await agent.post("/api/leagues").send({ name: "Liga Repetida" });
    const second = await agent.post("/api/leagues").send({ name: "Liga Repetida" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
  });

  it("GET /leagues sin q devuelve todas las ligas; con q filtra por nombre", async () => {
    const agent = await organizer();
    await agent.post("/api/leagues").send({ name: "Liga Alfa" });
    await agent.post("/api/leagues").send({ name: "Liga Beta" });

    const all = await agent.get("/api/leagues");
    expect(all.status).toBe(200);
    expect(all.body.map((l: { name: string }) => l.name)).toEqual(expect.arrayContaining(["Liga Alfa", "Liga Beta"]));

    const filtered = await agent.get("/api/leagues?q=Alfa");
    expect(filtered.body.map((l: { name: string }) => l.name)).toEqual(["Liga Alfa"]);

    expect((await request(app).get("/api/leagues")).status).toBe(401);
  });
});

describe("participantes ya inscritos en una liga", () => {
  it("GET /leagues/:id/participantes devuelve quienes ya jugaron otro torneo de la misma liga", async () => {
    const agent = await organizer();
    const liga = await agent.post("/api/leagues").send({ name: "Liga Part" });
    const leagueId = liga.body.id as string;
    const t1 = await agent
      .post("/api/tournaments")
      .send({ name: "Liga P1", date: "2026-01-01", numRounds: 1, leagueId });
    await agent.post(`/api/tournaments/${t1.body.id}/players`).send({ lastName: "Uno" });

    // Otro torneo, sin liga: no debe aparecer en la lista de la liga.
    const tSuelto = await agent.post("/api/tournaments").send({ name: "Suelto", date: "2026-02-01", numRounds: 1 });
    await agent.post(`/api/tournaments/${tSuelto.body.id}/players`).send({ lastName: "Afuera" });

    const res = await agent.get(`/api/leagues/${leagueId}/participantes`);
    expect(res.status).toBe(200);
    expect(res.body.map((p: { lastName: string }) => p.lastName)).toEqual(["Uno"]);
  });

  it("vacío para una liga recién creada", async () => {
    const agent = await organizer();
    const liga = await agent.post("/api/leagues").send({ name: "Liga Vacía" });
    const t = await agent
      .post("/api/tournaments")
      .send({ name: "Liga vacía", date: "2026-01-01", numRounds: 1, leagueId: liga.body.id });
    const res = await agent.get(`/api/leagues/${t.body.leagueId}/participantes`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("exige sesión de organizador", async () => {
    expect((await request(app).get("/api/leagues/x/participantes")).status).toBe(401);
    expect((await request(app).get("/api/leagues?q=Liga")).status).toBe(401);
  });
});

describe("headers de seguridad", () => {
  it("manda CSP y anti-clickjacking, y no expone X-Powered-By", async () => {
    const res = await request(app).get("/api/tournaments");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
