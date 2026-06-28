import "dotenv/config";
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../app";

// These exercise routing + validation only — no DB writes, no SEC network calls.
describe("API routes", () => {
  it("GET /api/health → ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /api/companies → the insurer seed", async () => {
    const res = await request(app).get("/api/companies");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.companies)).toBe(true);
    expect(res.body.companies.length).toBeGreaterThan(50);
    expect(res.body.companies[0]).toHaveProperty("cik");
    expect(res.body.companies[0]).toHaveProperty("sic");
  });

  it("POST /api/auth/signup rejects an invalid email", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "not-an-email", password: "longenough" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it("POST /api/auth/signup rejects a short password", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "someone@example.com", password: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 characters/i);
  });

  it("GET /api/watchlist requires authentication", async () => {
    const res = await request(app).get("/api/watchlist");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/session is null when signed out", async () => {
    const res = await request(app).get("/api/auth/session");
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});
