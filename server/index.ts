import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import "./db";
import tournamentsRouter from "./routes/tournaments";
import playersRouter from "./routes/players";
import roundsRouter from "./routes/rounds";
import authRouter from "./routes/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const cookieSecret = process.env.SESSION_COOKIE_SECRET;
if (!cookieSecret) {
  console.warn(
    "[chess-manager] SESSION_COOKIE_SECRET no está seteada: se usa un secret efímero " +
      "generado en memoria. Las sesiones no sobrevivirán un reinicio del server. " +
      "Seteala en producción (ver .env.example).",
  );
}
app.use(cookieParser(cookieSecret ?? crypto.randomBytes(32).toString("hex")));

if (!process.env.ORGANIZER_PASSWORD_HASH) {
  console.warn(
    "[chess-manager] ORGANIZER_PASSWORD_HASH no está seteada: el login del organizador " +
      "estará deshabilitado (la app sigue funcionando en modo solo lectura). " +
      "Generala con: npm run hash-password",
  );
}

app.use("/api", authRouter);
app.use("/api", tournamentsRouter);
app.use("/api", playersRouter);
app.use("/api", roundsRouter);

if (process.env.NODE_ENV === "production") {
  const distDir = path.join(__dirname, "..", "dist");
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`chess-manager server listening on :${port}`);
});
