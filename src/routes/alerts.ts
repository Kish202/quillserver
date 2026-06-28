import { Router, type Request } from "express";
import { eq } from "drizzle-orm";

import { db, withDbRetry } from "../db";
import { alertPrefs } from "../db/schema";
import { requireAuth, type SessionUser } from "../auth/jwt";
import { seedSent, sendTestAlert } from "../lib/alerts";

const router = Router();
router.use(requireAuth);

const userOf = (req: Request) => (req as Request & { user: SessionUser }).user;
const FREQS = ["realtime", "daily", "weekly"];

router.get("/", async (req, res) => {
  const user = userOf(req);
  const rows = await withDbRetry(() =>
    db.select().from(alertPrefs).where(eq(alertPrefs.userId, user.id)).limit(1)
  );
  const p = rows[0];
  res.json(
    p
      ? {
          enabled: p.enabled,
          watchlistOnly: p.watchlistOnly,
          forms: p.forms,
          frequency: p.frequency,
          email: p.email || user.email,
        }
      : {
          enabled: false,
          watchlistOnly: true,
          forms: "8-K,10-K",
          frequency: "realtime",
          email: user.email,
        }
  );
});

router.put("/", async (req, res) => {
  const user = userOf(req);
  const body = req.body || {};
  const forms = Array.isArray(body.forms)
    ? body.forms.join(",")
    : String(body.forms || "8-K,10-K");
  const frequency = FREQS.includes(body.frequency) ? body.frequency : "realtime";
  const email = (body.email && String(body.email).trim()) || user.email;

  const set = {
    enabled: !!body.enabled,
    watchlistOnly: body.watchlistOnly !== false,
    forms,
    frequency,
    email,
    updatedAt: new Date(),
  };

  const saved = (
    await withDbRetry(() =>
      db
        .insert(alertPrefs)
        .values({ userId: user.id, ...set })
        .onConflictDoUpdate({ target: alertPrefs.userId, set })
        .returning()
    )
  )[0];

  // When enabling real-time alerts, baseline current filings so the user
  // isn't blasted with everything already on EDGAR. Runs in the background.
  if (saved.enabled && saved.frequency === "realtime") {
    seedSent(user.id, saved).catch((e) => console.error("seedSent failed:", e));
  }

  res.json({ ok: true });
});

router.post("/test", async (req, res) => {
  const user = userOf(req);
  const body = req.body || {};
  try {
    const count = await sendTestAlert(user.id, {
      watchlistOnly: body.watchlistOnly,
      forms: Array.isArray(body.forms) ? body.forms.join(",") : body.forms,
      email: body.email,
    });
    res.json({ ok: true, count });
  } catch (e) {
    console.error("test alert failed:", e);
    res.status(500).json({ error: "Could not send the test email." });
  }
});

export default router;
