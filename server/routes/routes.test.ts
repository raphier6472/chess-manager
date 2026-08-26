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

describe("headers de seguridad", () => {
  it("manda CSP y anti-clickjacking, y no expone X-Powered-By", async () => {
    const res = await request(app).get("/api/tournaments");
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
