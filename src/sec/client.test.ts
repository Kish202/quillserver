import { describe, it, expect } from "vitest";
import { padCik, bareCik, normalizeFilings, type Submissions } from "./client";

describe("CIK helpers", () => {
  it("zero-pads to 10 digits", () => {
    expect(padCik("80661")).toBe("0000080661");
    expect(padCik(80661)).toBe("0000080661");
    expect(padCik("CIK0000080661")).toBe("0000080661");
  });
  it("strips to the bare numeric CIK", () => {
    expect(bareCik("0000080661")).toBe("80661");
    expect(bareCik("0000005272")).toBe("5272");
  });
});

describe("normalizeFilings", () => {
  const sub = {
    cik: "0000080661",
    filings: {
      recent: {
        accessionNumber: ["0000080661-25-000010"],
        form: ["10-K"],
        filingDate: ["2025-02-26"],
        reportDate: ["2024-12-31"],
        acceptanceDateTime: ["2025-02-26T16:00:00.000Z"],
        primaryDocument: ["pgr-20241231.htm"],
        primaryDocDescription: ["10-K"],
        items: [""],
        size: [123456],
        isXBRL: [1],
      },
    },
  } as unknown as Submissions;

  it("maps the parallel recent arrays into Filing objects", () => {
    const out = normalizeFilings(sub);
    expect(out).toHaveLength(1);
    expect(out[0].form).toBe("10-K");
    expect(out[0].filingDate).toBe("2025-02-26");
    expect(out[0].isXBRL).toBe(true);
  });

  it("builds the SEC document URL with the bare CIK + dashless accession", () => {
    const out = normalizeFilings(sub);
    expect(out[0].documentUrl).toBe(
      "https://www.sec.gov/Archives/edgar/data/80661/000008066125000010/pgr-20241231.htm"
    );
  });

  it("respects the limit option", () => {
    const many = {
      cik: "0000080661",
      filings: {
        recent: {
          accessionNumber: ["a-1", "a-2", "a-3"],
          form: ["8-K", "8-K", "8-K"],
          filingDate: ["2025-01-01", "2025-01-02", "2025-01-03"],
          reportDate: ["", "", ""],
          acceptanceDateTime: ["", "", ""],
          primaryDocument: ["x.htm", "y.htm", "z.htm"],
          primaryDocDescription: ["", "", ""],
          items: ["", "", ""],
          size: [1, 2, 3],
          isXBRL: [0, 0, 0],
        },
      },
    } as unknown as Submissions;
    expect(normalizeFilings(many, { limit: 2 })).toHaveLength(2);
  });
});
