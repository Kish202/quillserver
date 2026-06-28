import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Purpose-scoped, short-lived tokens for email verification and password reset.
// `extraSecret` (e.g. the user's current password hash) makes a token single-use:
// once the bound value changes, the token no longer verifies.
export function signPurposeToken(
  payload: { sub: string; purpose: "verify-email" | "reset-password" },
  expiresIn: string,
  extraSecret = ""
): string {
  return jwt.sign(payload, SECRET + extraSecret, {
    expiresIn,
  } as jwt.SignOptions);
}

export function verifyPurposeToken(
  token: string,
  purpose: "verify-email" | "reset-password",
  extraSecret = ""
): { sub: string } | null {
  try {
    const d = jwt.verify(token, SECRET + extraSecret) as {
      sub?: string;
      purpose?: string;
    };
    if (!d.sub || d.purpose !== purpose) return null;
    return { sub: d.sub };
  } catch {
    return null;
  }
}
