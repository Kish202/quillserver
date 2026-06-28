import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const COOKIE = "quill_token";
const isProd = process.env.NODE_ENV === "production";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image?: string | null;
};

export function signSession(res: Response, user: SessionUser) {
  const token = jwt.sign(user, SECRET, { expiresIn: "30d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    maxAge: 30 * 24 * 3600 * 1000,
    path: "/",
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: "/", sameSite: isProd ? "none" : "lax", secure: isProd });
}

export function getUser(req: Request): SessionUser | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const d = jwt.verify(token, SECRET) as SessionUser;
    return { id: d.id, email: d.email, name: d.name ?? null, image: d.image ?? null };
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  (req as Request & { user: SessionUser }).user = user;
  next();
}
