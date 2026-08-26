import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME, touchSession } from "../auth/session";

const isProd = process.env.NODE_ENV === "production";

export const cookieOptions = {
  httpOnly: true,
  signed: true,
  sameSite: "lax" as const,
  secure: isProd,
  path: "/",
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.signedCookies?.[SESSION_COOKIE_NAME];
  if (!token || !touchSession(token)) {
    res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    return res.status(401).json({ error: "tu sesión expiró: vuelve a entrar como organizador" });
  }
  next();
}
