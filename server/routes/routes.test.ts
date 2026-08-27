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

describe("headers de seguridad", () => {
  it("manda CSP y anti-clickjacking, y no expone X-Powered-By", async () => {
    const res = await request(app).get("/api/tournaments");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
