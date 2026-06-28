import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";

import { db, withDbRetry } from "../db";
import { watchlists } from "../db/schema";
import { requireAuth, type SessionUser } from "../auth/jwt";

const router = Router();
router.use(requireAuth);

const userOf = (req: Request) => (req as Request & { user: SessionUser }).user;

router.get("/", async (req, res) => {
  const user = userOf(req);
  try {
    const rows = await withDbRetry(() =>
      db
        .select({ cik: watchlists.cik })
        .from(watchlists)
        .where(eq(watchlists.userId, user.id))
    );
    res.json({ ciks: rows.map((r) => r.cik) });
  } catch {
    res.json({ ciks: [], error: "db_unavailable" });
  }
});

router.post("/", async (req, res) => {
  const user = userOf(req);
  const cik = String(req.body?.cik || "");
  if (!cik) return res.status(400).json({ error: "cik required" });
  await withDbRetry(() =>
    db
      .insert(watchlists)
      .values({ userId: user.id, cik })
      .onConflictDoNothing()
  );
  res.json({ ok: true });
});

router.delete("/", async (req, res) => {
  const user = userOf(req);
  const cik = String(req.body?.cik || "");
  if (!cik) return res.status(400).json({ error: "cik required" });
  await withDbRetry(() =>
    db
      .delete(watchlists)
      .where(and(eq(watchlists.userId, user.id), eq(watchlists.cik, cik)))
  );
  res.json({ ok: true });
});

export default router;
