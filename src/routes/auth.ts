import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";

import { db, withDbRetry } from "../db";
import { users } from "../db/schema";
import {
  signSession,
  clearSession,
  getUser,
  type SessionUser,
} from "../auth/jwt";
import { passport, googleEnabled } from "../auth/google";
import { signPurposeToken, verifyPurposeToken } from "../auth/tokens";
import { sendEmail, verifyEmailHtml, resetPasswordHtml } from "../lib/email";

const router = Router();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";

async function sendVerificationEmail(userId: string, email: string) {
  const token = signPurposeToken({ sub: userId, purpose: "verify-email" }, "24h");
  const link = `${SERVER_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendEmail(email, "Verify your Quill email", verifyEmailHtml(link), `Verify your email: ${link}`);
}

router.get("/session", (req, res) => {
  res.json({ user: getUser(req) });
});

router.post("/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim();
  if (!EMAIL_RE.test(email))
    return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });

  const existing = await withDbRetry(() =>
    db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  );
  if (existing[0])
    return res
      .status(409)
      .json({ error: "That email is already registered — log in instead." });

  const hash = await bcrypt.hash(password, 10);
  const inserted = await withDbRetry(() =>
    db
      .insert(users)
      .values({ email, name: name || email.split("@")[0], password: hash })
      .returning()
  );
  const u = inserted[0];
  // Fire-and-forget — never block the response on email delivery (a slow/blocked
  // SMTP host must not freeze signup).
  void sendVerificationEmail(u.id, email).catch((e) =>
    console.error("verification email failed:", e)
  );
  // No auto-login — the user must verify their email before signing in.
  res.json({ verificationRequired: true });
});

router.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password)
    return res.status(400).json({ error: "Enter your email and password." });

  const rows = await withDbRetry(() =>
    db.select().from(users).where(eq(users.email, email)).limit(1)
  );
  const u = rows[0];
  if (!u?.password)
    return res.status(401).json({ error: "No account found for that email — sign up first." });
  const ok = await bcrypt.compare(password, u.password);
  if (!ok) return res.status(401).json({ error: "Invalid email or password." });

  if (!u.emailVerified) {
    return res.status(403).json({
      error: "Please verify your email first — check your inbox for the link.",
      verificationRequired: true,
    });
  }

  const session: SessionUser = { id: u.id, email: u.email!, name: u.name, image: u.image };
  signSession(res, session);
  res.json({ user: session });
});

router.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

/* -------------------------- Email verification -------------------------- */

router.get("/verify-email", async (req, res) => {
  const token = String(req.query.token || "");
  const ok = verifyPurposeToken(token, "verify-email");
  if (!ok) return res.redirect(`${CLIENT_URL}/verify-email?status=invalid`);
  try {
    await withDbRetry(() =>
      db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, ok.sub))
    );
    const rows = await withDbRetry(() =>
      db.select().from(users).where(eq(users.id, ok.sub)).limit(1)
    );
    const u = rows[0];
    // Log them in on verification so the link drops them straight into the app.
    if (u) signSession(res, { id: u.id, email: u.email!, name: u.name, image: u.image });
  } catch {
    return res.redirect(`${CLIENT_URL}/verify-email?status=error`);
  }
  res.redirect(`${CLIENT_URL}/verify-email?status=success`);
});

router.post("/resend-verification", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (EMAIL_RE.test(email)) {
    try {
      const rows = await withDbRetry(() =>
        db.select().from(users).where(eq(users.email, email)).limit(1)
      );
      const u = rows[0];
      if (u && !u.emailVerified)
        void sendVerificationEmail(u.id, email).catch((e) =>
          console.error("resend failed:", e)
        );
    } catch (e) {
      console.error("resend-verification failed:", e);
    }
  }
  res.json({ ok: true }); // generic — don't reveal whether the account exists
});

/* ---------------------------- Password reset ---------------------------- */

router.post("/forgot", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (EMAIL_RE.test(email)) {
    try {
      const rows = await withDbRetry(() =>
        db.select().from(users).where(eq(users.email, email)).limit(1)
      );
      const u = rows[0];
      if (u?.password) {
        const token = signPurposeToken(
          { sub: u.id, purpose: "reset-password" },
          "1h",
          u.password // bind to current hash → single-use
        );
        const link = `${CLIENT_URL}/reset-password?token=${encodeURIComponent(token)}`;
        void sendEmail(
          email,
          "Reset your Quill password",
          resetPasswordHtml(link),
          `Reset your password: ${link}`
        ).catch((e) => console.error("reset email failed:", e));
      }
    } catch (e) {
      console.error("forgot-password failed:", e);
    }
  }
  // Always generic — never reveal whether an account exists.
  res.json({ ok: true });
});

router.post("/reset", async (req, res) => {
  const token = String(req.body?.token || "");
  const password = String(req.body?.password || "");
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });

  const decoded = jwt.decode(token) as { sub?: string } | null;
  if (!decoded?.sub)
    return res.status(400).json({ error: "Invalid or expired reset link." });

  const rows = await withDbRetry(() =>
    db.select().from(users).where(eq(users.id, decoded.sub!)).limit(1)
  );
  const u = rows[0];
  if (!u?.password)
    return res.status(400).json({ error: "Invalid or expired reset link." });

  const ok = verifyPurposeToken(token, "reset-password", u.password);
  if (!ok) return res.status(400).json({ error: "Invalid or expired reset link." });

  const hash = await bcrypt.hash(password, 10);
  await withDbRetry(() =>
    db.update(users).set({ password: hash }).where(eq(users.id, u.id))
  );
  res.json({ ok: true });
});

if (googleEnabled) {
  router.get(
    "/google",
    passport.authenticate("google", { scope: ["profile", "email"], session: false })
  );
  router.get(
    "/google/callback",
    passport.authenticate("google", {
      session: false,
      failureRedirect: `${CLIENT_URL}/login`,
    }),
    (req: Request, res) => {
      const user = req.user as SessionUser | undefined;
      if (user) signSession(res, user);
      res.redirect(`${CLIENT_URL}/home`);
    }
  );
}

export default router;
