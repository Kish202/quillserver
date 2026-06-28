import { Router } from "express";

import { INSURERS } from "../sec/insurers";
import { getSubmissions, normalizeFilings, padCik } from "../sec/client";
import { insuranceFilings, daysAgoISO } from "../sec/feed";
import { getKeyFinancials, type KeyFinancials } from "../sec/financials";

const router = Router();

// Full insurer index (static seed)
router.get("/companies", (_req, res) => {
  res.json({ companies: INSURERS });
});

// Company detail: header + live filings + XBRL financials
router.get("/companies/:cik", async (req, res) => {
  const cik = padCik(req.params.cik);
  let sub;
  try {
    sub = await getSubmissions(cik);
  } catch {
    return res.status(404).json({ error: "Company not found" });
  }
  const filings = normalizeFilings(sub, { limit: 300 });
  let financials: KeyFinancials | null = null;
  try {
    financials = await getKeyFinancials(cik);
  } catch {
    financials = null;
  }
  res.json({
    company: {
      cik,
      name: sub.name,
      sic: sub.sic,
      sicDescription: sub.sicDescription,
      tickers: sub.tickers,
      exchanges: sub.exchanges,
      fiscalYearEnd: sub.fiscalYearEnd,
      stateOfIncorporation: sub.stateOfIncorporation,
      website: sub.website,
      address: sub.addresses?.business,
    },
    filings,
    financials,
  });
});

// Filings feed / full-text search
router.get("/filings", async (req, res) => {
  try {
    const data = await insuranceFilings({
      q: String(req.query.q || ""),
      forms: req.query.forms ? String(req.query.forms) : undefined,
      from: Number(req.query.from) || 0,
      startdt: req.query.startdt ? String(req.query.startdt) : undefined,
      enddt: req.query.enddt ? String(req.query.enddt) : undefined,
    });
    res.json(data);
  } catch (e) {
    res.status(502).json({ total: 0, returned: 0, rows: [], error: String(e) });
  }
});

// Home dashboard: KPIs + recent filings
router.get("/home", async (_req, res) => {
  const KEY = "8-K,10-K,10-Q,DEF 14A,S-1,S-3,424B5";
  const empty = { total: 0, returned: 0, rows: [] };
  const [recent, week, m30] = await Promise.all([
    insuranceFilings({ forms: KEY }).catch(() => empty),
    insuranceFilings({ forms: "8-K,10-K,10-Q,DEF 14A", startdt: daysAgoISO(7) }).catch(() => empty),
    insuranceFilings({ forms: "8-K", startdt: daysAgoISO(30) }).catch(() => empty),
  ]);
  res.json({
    companies: INSURERS.length,
    filingsThisWeek: week.total,
    eightK30d: m30.total,
    recent: recent.rows.slice(0, 8),
  });
});

// Multi-company financial comparison
const COMPARE = [
  "0000080661", "0000086312", "0000899051", "0000896159", "0000005272",
  "0001099219", "0001137774", "0000004977", "0000874766", "0000020286",
];
router.get("/financials", async (_req, res) => {
  const rows: { cik: string; fin: KeyFinancials | null }[] = [];
  for (const cik of COMPARE) {
    let fin: KeyFinancials | null = null;
    try {
      fin = await getKeyFinancials(cik);
    } catch {
      fin = null;
    }
    rows.push({ cik, fin });
  }
  res.json({ rows });
});

export default router;
