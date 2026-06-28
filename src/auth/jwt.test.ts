import { describe, it, expect, vi } from "vitest";
import { signSession, getUser, requireAuth, type SessionUser } from "./jwt";

const user: SessionUser = { id: "u1", email: "tania@quill.app", name: "Tania", image: null };

// Minimal Express res/req stand-ins that capture cookie + status.
function fakeRes() {
  return {
    jar: {} as Record<string, string>,
    statusCode: 0,
    body: undefined as unknown,
    cookie(name: string, value: string) {
      this.jar[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
}

describe("jwt session", () => {
  it("round-trips a signed session cookie", () => {
    const res = fakeRes();
    signSession(res as never, user);
    const token = res.jar["quill_token"];
    expect(token).toBeTruthy();

    const got = getUser({ cookies: { quill_token: token } } as never);
    expect(got?.id).toBe("u1");
    expect(got?.email).toBe("tania@quill.app");
    expect(got?.name).toBe("Tania");
  });

  it("getUser returns null when there is no cookie", () => {
    expect(getUser({ cookies: {} } as never)).toBeNull();
  });

  it("getUser returns null for a tampered token", () => {
    expect(getUser({ cookies: { quill_token: "not.a.jwt" } } as never)).toBeNull();
  });

  it("requireAuth 401s without a session", () => {
    const res = fakeRes();
    const next = vi.fn();
    requireAuth({ cookies: {} } as never, res as never, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("requireAuth calls next for a valid session", () => {
    const signRes = fakeRes();
    signSession(signRes as never, user);
    const token = signRes.jar["quill_token"];

    const res = fakeRes();
    const next = vi.fn();
    requireAuth({ cookies: { quill_token: token } } as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});
