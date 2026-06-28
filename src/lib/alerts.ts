import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { alertPrefs, alertSent, watchlists, users, type AlertPrefs } from "../db/schema";
import { insuranceFilings, daysAgoISO, type FeedRow } from "../sec/feed";
import { sendEmail } from "./email";

// Forms the feed pulls; user families are filtered from this set.
const FEED_FORMS = "8-K,10-K,10-Q,DEF 14A,S-1,SC 13D,SC 13G";

/* ------------------------------- matching ------------------------------- */

function formMatches(form: string, families: Set<string>): boolean {
  const f = form.toUpperCase();
  for (const fam of families) {
    if (fam === "SC 13D/G") {
      if (f.startsWith("SC 13D") || f.startsWith("SC 13G")) return true;
    } else if (fam === "DEF 14A") {
      if (f.includes("14A")) return true;
    } else if (f.startsWith(fam.toUpperCase())) {
      return true;
    }
  }
  return false;
}

async function watchlistCiks(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ cik: watchlists.cik })
    .from(watchlists)
    .where(eq(watchlists.userId, userId));
  return new Set(rows.map((r) => r.cik.padStart(10, "0")));
}

async function userEmail(userId: string): Promise<string | null> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
}

function matchRows(rows: FeedRow[], p: AlertPrefs, ciks: Set<string>): FeedRow[] {
  const families = new Set(
    p.forms.split(",").map((s) => s.trim()).filter(Boolean)
  );
  return rows.filter(
    (r) =>
      formMatches(r.form, families) &&
      (!p.watchlistOnly || ciks.has(r.cik.padStart(10, "0")))
  );
}

/* ------------------------------- emails -------------------------------- */

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Llc|Plc|Inc|Corp)\b/g, (m) => m);

function alertHtml(rows: FeedRow[], heading: string, intro: string): string {
  const items = rows
    .map(
      (r) => `
    <tr>
      <td style="padding:10px 0;border-top:1px solid #eee">
        <a href="${r.documentUrl}" style="color:#2b2926;text-decoration:none;font-weight:600">${titleCase(r.company)}</a><br>
        <span style="font-size:12px;color:#8a897f">${r.form} · ${r.filedAt}</span>
      </td>
      <td style="padding:10px 0;border-top:1px solid #eee;text-align:right;vertical-align:middle">
        <a href="${r.documentUrl}" style="font-size:12px;color:#3d5570;text-decoration:none">Open&nbsp;↗</a>
      </td>
    </tr>`
    )
    .join("");
  return `<div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#2b2926">
    <div style="font-size:20px;font-weight:700">✎ Quill</div>
    <h1 style="font-size:20px;margin:20px 0 4px">${heading}</h1>
    <p style="font-size:13px;color:#56554f;margin:0">${intro}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:14px">${items}</table>
    <p style="font-size:12px;color:#a8a79d;margin-top:24px">You're receiving this because you turned on Quill alerts. Manage them under Alerts in the app.</p>
  </div>`;
}

const alertText = (rows: FeedRow[]) =>
  rows.map((r) => `${titleCase(r.company)} — ${r.form} (${r.filedAt}): ${r.documentUrl}`).join("\n");

async function deliver(p: AlertPrefs, rows: FeedRow[], heading: string, intro: string) {
  const to = p.email || (await userEmail(p.userId));
  if (!to || !rows.length) return;
  await sendEmail(to, heading, alertHtml(rows, heading, intro), alertText(rows));
}

/* ------------------------------- feed ---------------------------------- */

async function recentFeed(days?: number): Promise<FeedRow[]> {
  const res = await insuranceFilings(
    days ? { forms: FEED_FORMS, startdt: daysAgoISO(days) } : { forms: FEED_FORMS }
  );
  return res.rows;
}

/* ------------------------------- runners ------------------------------- */

/** Mark the current matching feed as already-seen, so enabling doesn't blast old filings. */
export async function seedSent(userId: string, p: AlertPrefs) {
  const feed = await recentFeed();
  const ciks = p.watchlistOnly ? await watchlistCiks(userId) : new Set<string>();
  const matches = matchRows(feed, p, ciks);
  for (const m of matches) {
    await db
      .insert(alertSent)
      .values({ userId, accession: m.accessionNoDash })
      .onConflictDoNothing();
  }
}

export async function runRealtimeAlerts() {
  const prefs = await db
    .select()
    .from(alertPrefs)
    .where(and(eq(alertPrefs.enabled, true), eq(alertPrefs.frequency, "realtime")));
  if (!prefs.length) return;

  const feed = await recentFeed();
  for (const p of prefs) {
    const ciks = p.watchlistOnly ? await watchlistCiks(p.userId) : new Set<string>();
    const matches = matchRows(feed, p, ciks);
    if (!matches.length) continue;

    const sentRows = await db
      .select({ a: alertSent.accession })
      .from(alertSent)
      .where(eq(alertSent.userId, p.userId));
    const sent = new Set(sentRows.map((r) => r.a));
    const fresh = matches.filter((m) => !sent.has(m.accessionNoDash));
    if (!fresh.length) continue;

    await deliver(
      p,
      fresh,
      `Quill alert — ${fresh.length} new filing${fresh.length > 1 ? "s" : ""}`,
      "New SEC filings matching your alert:"
    );
    for (const m of fresh) {
      await db
        .insert(alertSent)
        .values({ userId: p.userId, accession: m.accessionNoDash })
        .onConflictDoNothing();
    }
    console.log(`📨 realtime alert → ${p.userId}: ${fresh.length} filing(s)`);
  }
}

export async function runDigests(now = Date.now()) {
  const prefs = await db.select().from(alertPrefs).where(eq(alertPrefs.enabled, true));
  for (const p of prefs) {
    if (p.frequency === "realtime") continue;
    const intervalMs = p.frequency === "weekly" ? 7 * 86_400_000 : 86_400_000;
    const last = p.lastDigestAt ? p.lastDigestAt.getTime() : 0;
    if (now - last < intervalMs) continue;

    const days = p.frequency === "weekly" ? 7 : 1;
    const feed = await recentFeed(days);
    const ciks = p.watchlistOnly ? await watchlistCiks(p.userId) : new Set<string>();
    const matches = matchRows(feed, p, ciks);

    if (matches.length) {
      await deliver(
        p,
        matches,
        `Quill ${p.frequency} digest — ${matches.length} filing${matches.length > 1 ? "s" : ""}`,
        `Insurance filings from the last ${p.frequency === "weekly" ? "week" : "day"}:`
      );
      console.log(`📨 ${p.frequency} digest → ${p.userId}: ${matches.length} filing(s)`);
    }
    await db
      .update(alertPrefs)
      .set({ lastDigestAt: new Date(now) })
      .where(eq(alertPrefs.userId, p.userId));
  }
}

/** Immediate sample for the "Send test email" button (ignores dedup/schedule). */
export async function sendTestAlert(
  userId: string,
  override?: { watchlistOnly?: boolean; forms?: string; email?: string | null }
): Promise<number> {
  const saved = (await db.select().from(alertPrefs).where(eq(alertPrefs.userId, userId)).limit(1))[0];
  const p: AlertPrefs = {
    userId,
    enabled: true,
    watchlistOnly: override?.watchlistOnly ?? saved?.watchlistOnly ?? true,
    forms: override?.forms ?? saved?.forms ?? "8-K,10-K",
    frequency: "realtime",
    email: override?.email ?? saved?.email ?? null,
    lastDigestAt: null,
    updatedAt: new Date(),
  };
  const feed = await recentFeed();
  const ciks = p.watchlistOnly ? await watchlistCiks(userId) : new Set<string>();
  const matches = matchRows(feed, p, ciks).slice(0, 8);
  const rows = matches.length ? matches : feed.slice(0, 5); // always show something
  await deliver(
    p,
    rows,
    "Quill test alert",
    "This is a sample of what your alerts will look like:"
  );
  return rows.length;
}

/* ------------------------------ scheduler ------------------------------ */

let timer: ReturnType<typeof setInterval> | null = null;

export function startAlertScheduler() {
  if (timer) return;
  const minutes = Number(process.env.ALERT_INTERVAL_MIN) || 5;
  const tick = async () => {
    try {
      await runRealtimeAlerts();
      await runDigests();
    } catch (e) {
      console.error("alert tick failed:", e);
    }
  };
  timer = setInterval(tick, minutes * 60_000);
  console.log(`⏰ Alert scheduler running every ${minutes} min`);
}
