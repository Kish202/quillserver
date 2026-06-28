import { getCompanyConcept, type ConceptUnits } from "./client";

export function latestAnnualUSD(c: ConceptUnits | null) {
  const usd = c?.units?.["USD"];
  if (!usd?.length) return null;
  const annual = usd.filter((x) => x.form === "10-K");
  const pool = annual.length ? annual : usd;
  let best = pool[0];
  for (const x of pool) if (x.end > best.end) best = x;
  return best ? { val: best.val, end: best.end } : null;
}

export type KeyFinancials = {
  revenue: number | null;
  netIncome: number | null;
  assets: number | null;
  equity: number | null;
  fy: string | null;
};

export async function getKeyFinancials(cik: string): Promise<KeyFinancials> {
  const [assets, rev1, rev2, ni, eq] = await Promise.all([
    getCompanyConcept(cik, "Assets"),
    getCompanyConcept(cik, "Revenues"),
    getCompanyConcept(cik, "RevenuesNetOfInterestExpense"),
    getCompanyConcept(cik, "NetIncomeLoss"),
    getCompanyConcept(cik, "StockholdersEquity"),
  ]);
  const revenue = latestAnnualUSD(rev1) ?? latestAnnualUSD(rev2);
  const a = latestAnnualUSD(assets);
  const ninc = latestAnnualUSD(ni);
  const e = latestAnnualUSD(eq);
  return {
    revenue: revenue?.val ?? null,
    netIncome: ninc?.val ?? null,
    assets: a?.val ?? null,
    equity: e?.val ?? null,
    fy: (revenue?.end ?? a?.end ?? ninc?.end ?? "").slice(0, 4) || null,
  };
}
