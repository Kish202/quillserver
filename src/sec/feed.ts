import { fullTextSearch, type FtsHit } from "./client";
import { INSURERS, getInsurer } from "./insurers";

export const INSURER_CIK_PARAM = INSURERS.map((c) => c.cik).join(",");

export type FeedRow = {
  cik: string;
  company: string;
  ticker: string;
  sic: string;
  form: string;
  filedAt: string;
  documentUrl: string;
  accessionNoDash: string;
  isSeed: boolean;
};

/** Resolve an efts hit to the insurer it belongs to (hits may list an insider as filer). */
function resolveRow(hit: FtsHit): FeedRow {
  for (const c of hit.ciks) {
    const seed = getInsurer(c);
    if (seed) {
      return {
        cik: seed.cik,
        company: seed.name,
        ticker: seed.ticker,
        sic: seed.sic,
        form: hit.form,
        filedAt: hit.filedAt,
        documentUrl: hit.documentUrl,
        accessionNoDash: hit.accessionNoDash,
        isSeed: true,
      };
    }
  }
  return {
    cik: (hit.ciks[0] || "").replace(/^0+/, ""),
    company: hit.displayNames[0] || "Unknown filer",
    ticker: "",
    sic: "",
    form: hit.form,
    filedAt: hit.filedAt,
    documentUrl: hit.documentUrl,
    accessionNoDash: hit.accessionNoDash,
    isSeed: false,
  };
}

export type FilingsQuery = {
  q?: string;
  forms?: string;
  startdt?: string;
  enddt?: string;
  from?: number;
};

export async function insuranceFilings(opts: FilingsQuery = {}): Promise<{
  total: number;
  returned: number;
  rows: FeedRow[];
}> {
  const res = await fullTextSearch({
    q: opts.q ?? "",
    forms: opts.forms,
    startdt: opts.startdt,
    enddt: opts.enddt,
    ciks: INSURER_CIK_PARAM,
    from: opts.from,
  });
  return { total: res.total, returned: res.returned, rows: res.hits.map(resolveRow) };
}

export function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
