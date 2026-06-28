// Server-side SEC EDGAR client. Sets the required User-Agent, caches responses
// in-memory (TTL), and retries transient EDGAR errors.

// Keep this a simple "Name email@domain" — SEC's WAF rejects some UA patterns
// (e.g. noreply/auto-generated addresses) with 403.
const UA = process.env.SEC_USER_AGENT || "Quill Research tania2020076@gmail.com";

// SEC EDGAR blocks some datacenter IPs (e.g. Render) with 403. When SEC_PROXY_BASE
// is set (to a host whose IP isn't blocked, e.g. our Vercel app), route the
// *fetched* endpoints through its /sec-efts and /sec-data rewrites. Archive
// document links stay on sec.gov — those open in the user's own browser.
const PROXY = (process.env.SEC_PROXY_BASE || "").replace(/\/+$/, "");

const SUBMISSIONS = PROXY
  ? `${PROXY}/sec-data/submissions`
  : "https://data.sec.gov/submissions";
const XBRL = PROXY ? `${PROXY}/sec-data/api/xbrl` : "https://data.sec.gov/api/xbrl";
const EFTS = PROXY
  ? `${PROXY}/sec-efts/LATEST/search-index`
  : "https://efts.sec.gov/LATEST/search-index";
const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";

export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}
export function bareCik(cik: string | number): string {
  return String(Number(String(cik).replace(/\D/g, "")));
}

const cache = new Map<string, { expires: number; data: unknown }>();

async function secFetch<T>(url: string, ttlSec = 3600): Promise<T> {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data as T;

  const headers = {
    "User-Agent": UA,
    "Accept-Encoding": "gzip, deflate",
    Accept: "application/json",
  };
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = (await res.json()) as T;
      cache.set(url, { expires: Date.now() + ttlSec * 1000, data });
      return data;
    }
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`SEC ${res.status} ${res.statusText} for ${url}`);
    }
    lastError = new Error(`SEC ${res.status} ${res.statusText} for ${url}`);
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw lastError ?? new Error(`SEC request failed: ${url}`);
}

/* ----------------------------- Submissions ----------------------------- */

export type SecAddress = {
  street1?: string;
  city?: string;
  stateOrCountry?: string;
  zipCode?: string;
};

export type Submissions = {
  cik: string;
  name: string;
  sic: string;
  sicDescription: string;
  tickers: string[];
  exchanges: string[];
  ein?: string;
  fiscalYearEnd?: string;
  stateOfIncorporation?: string;
  website?: string;
  addresses?: { mailing?: SecAddress; business?: SecAddress };
  filings: { recent: Record<string, (string | number | boolean)[]> };
};

export type Filing = {
  accessionNumber: string;
  accessionNoDash: string;
  form: string;
  filingDate: string;
  reportDate: string;
  acceptanceDateTime: string;
  primaryDocument: string;
  primaryDocDescription: string;
  items: string;
  size: number;
  isXBRL: boolean;
  indexUrl: string;
  documentUrl: string;
};

export async function getSubmissions(cik: string): Promise<Submissions> {
  return secFetch<Submissions>(`${SUBMISSIONS}/CIK${padCik(cik)}.json`, 1800);
}

export function normalizeFilings(
  sub: Submissions,
  opts: { limit?: number } = {}
): Filing[] {
  const r = sub.filings?.recent;
  if (!r || !r.form) return [];
  const bare = bareCik(sub.cik);
  const n = r.form.length;
  const out: Filing[] = [];
  for (let i = 0; i < n; i++) {
    const acc = String(r.accessionNumber[i]);
    const accNoDash = acc.replace(/-/g, "");
    const primaryDocument = String(r.primaryDocument[i] || "");
    out.push({
      accessionNumber: acc,
      accessionNoDash: accNoDash,
      form: String(r.form[i]),
      filingDate: String(r.filingDate[i] || ""),
      reportDate: String(r.reportDate[i] || ""),
      acceptanceDateTime: String(r.acceptanceDateTime[i] || ""),
      primaryDocument,
      primaryDocDescription: String(r.primaryDocDescription[i] || ""),
      items: String(r.items[i] || ""),
      size: Number(r.size[i] || 0),
      isXBRL: Boolean(Number(r.isXBRL?.[i])),
      indexUrl: `${ARCHIVES}/${bare}/${accNoDash}/${acc}-index.htm`,
      documentUrl: primaryDocument
        ? `${ARCHIVES}/${bare}/${accNoDash}/${primaryDocument}`
        : `${ARCHIVES}/${bare}/${accNoDash}/`,
    });
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

/* --------------------------- Full-text search --------------------------- */

export type FtsHit = {
  accessionNoDash: string;
  ciks: string[];
  displayNames: string[];
  form: string;
  filedAt: string;
  fileName: string;
  documentUrl: string;
};

export async function fullTextSearch(params: {
  q?: string;
  forms?: string;
  startdt?: string;
  enddt?: string;
  ciks?: string;
  from?: number;
}): Promise<{ total: number; returned: number; hits: FtsHit[] }> {
  const sp = new URLSearchParams();
  sp.set("q", params.q ?? "");
  if (params.forms) sp.set("forms", params.forms);
  if (params.startdt || params.enddt) {
    sp.set("dateRange", "custom");
    if (params.startdt) sp.set("startdt", params.startdt);
    sp.set("enddt", params.enddt || new Date().toISOString().slice(0, 10));
  }
  if (params.ciks) sp.set("ciks", params.ciks);
  if (params.from) sp.set("from", String(params.from));

  const data = await secFetch<{
    hits: {
      total: { value: number };
      hits: {
        _id: string;
        _source: {
          ciks?: string[];
          root_forms?: string[];
          form?: string;
          file_date?: string;
          display_names?: string[];
        };
      }[];
    };
  }>(`${EFTS}?${sp.toString()}`, 600);

  const hits: FtsHit[] = (data.hits?.hits || []).map((h) => {
    const [adsh, fileName = ""] = h._id.split(":");
    const accessionNoDash = adsh.replace(/-/g, "");
    const filerCik = String(Number(adsh.split("-")[0] || "0"));
    return {
      accessionNoDash,
      ciks: (h._source.ciks || []).map((c) => c.padStart(10, "0")),
      displayNames: h._source.display_names || [],
      form: h._source.form || h._source.root_forms?.[0] || "",
      filedAt: h._source.file_date || "",
      fileName,
      documentUrl: `${ARCHIVES}/${filerCik}/${accessionNoDash}/${fileName}`,
    };
  });

  return {
    total: data.hits?.total?.value ?? hits.length,
    returned: hits.length,
    hits,
  };
}

/* ------------------------------- XBRL facts ----------------------------- */

export type ConceptUnits = {
  units: Record<
    string,
    { end: string; val: number; fy?: number; fp?: string; form?: string }[]
  >;
};

export async function getCompanyConcept(
  cik: string,
  tag: string,
  taxonomy = "us-gaap"
): Promise<ConceptUnits | null> {
  try {
    return await secFetch<ConceptUnits>(
      `${XBRL}/companyconcept/CIK${padCik(cik)}/${taxonomy}/${tag}.json`,
      3600
    );
  } catch {
    return null;
  }
}
