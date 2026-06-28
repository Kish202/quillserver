import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { users } from "../db/schema";
import type { SessionUser } from "./jwt";

export const googleEnabled =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: `${SERVER_URL}/api/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          if (!email) return done(null, false);
          const name = profile.displayName || email.split("@")[0];
          const image = profile.photos?.[0]?.value || null;

          const existing = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
          let user = existing[0];
          if (!user) {
            const inserted = await db
              .insert(users)
              .values({ email, name, image, emailVerified: new Date() })
              .returning();
            user = inserted[0];
          }
          const session: SessionUser = {
            id: user.id,
            email: user.email!,
            name: user.name,
            image: user.image,
          };
          done(null, session);
        } catch (e) {
          done(e as Error);
        }
      }
    )
  );
}

export { passport };
