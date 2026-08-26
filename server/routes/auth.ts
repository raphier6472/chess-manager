import { Router } from "express";
import rateLimit from "express-rate-limit";
import { verifyPassword } from "../auth/password";
import { createSession, destroySession, touchSession, SESSION_COOKIE_NAME } from "../auth/session";
import { cookieOptions } from "../middleware/auth";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many login attempts, try again later" },
  // Cloudflare reescribe CF-Connecting-IP en cada request, así que un cliente no puede
  // falsearlo a través del túnel (a diferencia de X-Forwarded-For, que sí es del cliente).
  // Sin ese header — acceso directo al origen, o desarrollo local — todos los intentos
  // caen en un único bucket: falla cerrado, nunca abierto.
  keyGenerator: (req) => {
    const cfIp = req.headers["cf-connecting-ip"];
    return typeof cfIp === "string" && cfIp ? cfIp : "shared-bucket";
  },
  // req.ip no se usa como clave, así que la validación de XFF de express-rate-limit
  // (que asume rate-limiting por IP) no aplica.
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

router.post("/auth/login", loginLimiter, (req, res) => {
  const storedHash = process.env.ORGANIZER_PASSWORD_HASH;
  if (!storedHash) {
    return res.status(500).json({ error: "organizer auth is not configured" });
  }
  const { password } = req.body ?? {};
  if (typeof password !== "string" || !password) {
    return res.status(400).json({ error: "password is required" });
  }
  if (!verifyPassword(password, storedHash)) {
    return res.status(401).json({ error: "invalid password" });
  }
  const { token, cookieMaxAgeMs } = createSession();
  res.cookie(SESSION_COOKIE_NAME, token, { ...cookieOptions, maxAge: cookieMaxAgeMs });
  res.status(200).json({ authenticated: true });
});

router.post("/auth/logout", (req, res) => {
  const token = req.signedCookies?.[SESSION_COOKIE_NAME];
  if (token) destroySession(token);
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
  res.status(204).end();
});

router.get("/auth/me", (req, res) => {
  const token = req.signedCookies?.[SESSION_COOKIE_NAME];
  const authenticated = !!token && touchSession(token);
  res.json({ authenticated });
});

export default router;
