import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import "./db";
import { parseStoredHash } from "./auth/password";
import tournamentsRouter from "./routes/tournaments";
import playersRouter from "./routes/players";
import roundsRouter from "./routes/rounds";
import authRouter from "./routes/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // NO confiar en X-Forwarded-For. Se probó `trust proxy: "loopback"` y volvía el
  // rate-limit del login evadible: como cloudflared se conecta desde loopback, Express
  // tomaba el IP del XFF que manda el propio cliente, así que rotando ese header cada
  // intento caía en un bucket distinto. El rate-limit usa CF-Connecting-IP (que
  // Cloudflare siempre reescribe) — ver keyGenerator en routes/auth.ts.
  app.set("trust proxy", false);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // El bundle de Vite es un único módulo local: no hace falta 'unsafe-inline'
          // ni 'unsafe-eval' acá, que es lo que realmente contiene un XSS.
          scriptSrc: ["'self'"],
          // Concesión consciente: la UI usa atributos style={{...}} en JSX y en CSP3
          // style-src cubre los atributos style salvo que se declare style-src-attr.
          styleSrc: ["'self'", "'unsafe-inline'"],
          // El favicon es un data: URI embebido en index.html.
          imgSrc: ["'self'", "data:"],
          // Las fuentes IBM Plex vienen de @fontsource, bundleadas por Vite.
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );

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

  const storedHash = process.env.ORGANIZER_PASSWORD_HASH;
  if (!storedHash) {
    console.warn(
      "[chess-manager] ORGANIZER_PASSWORD_HASH no está seteada: el login del organizador " +
        "estará deshabilitado (la app sigue funcionando en modo solo lectura). " +
        "Génerala con: npm run hash-password",
    );
  } else if (!parseStoredHash(storedHash)) {
    // Antes solo se comprobaba que la variable existiera. Un hash cortado al pegarlo en el
    // unit de systemd pasaba desapercibido, y el login quedaba roto sin que nadie lo notara.
    console.error(
      "[chess-manager] ORGANIZER_PASSWORD_HASH tiene un formato inválido: el login del " +
        "organizador queda DESHABILITADO. Suele pasar por un pegado cortado o partido en " +
        "varias líneas. Regénerala con: npm run hash-password",
    );
  }

  app.use("/api", authRouter);
  app.use("/api", tournamentsRouter);
  app.use("/api", playersRouter);
  app.use("/api", roundsRouter);

  // Sin esto, una ruta /api/* que ningún router reconoce cae en el catch-all de la SPA de
  // abajo y responde 200 con index.html en vez de un 404 — el cliente ve "éxito" con HTML
  // donde esperaba JSON.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "no se encontró el recurso" });
  });

  if (process.env.NODE_ENV === "production") {
    const distDir = path.join(__dirname, "..", "dist");
    app.use(express.static(distDir));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  return app;
}
