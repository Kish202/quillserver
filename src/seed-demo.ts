import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { users, watchlists } from "./db/schema";

// One-click demo login for reviewers. Generic identity → avatar shows "G".
export const DEMO_EMAIL = "demo@quill.app";
export const DEMO_PASSWORD = "quilldemo";
const DEMO_NAME = "Guest";

// A few marquee carriers so the demo watchlist isn't empty.
const DEMO_CIKS = [
  "0000080661", // Progressive
  "0000896159", // Chubb
  "0000005272", // AIG
  "0000899051", // Allstate
];

async function main() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, DEMO_EMAIL))
    .limit(1);

  let user = existing[0];
  if (user) {
    await db
      .update(users)
      .set({ name: DEMO_NAME, password: hash, emailVerified: new Date() })
      .where(eq(users.id, user.id));
    console.log(`Updated demo user (${user.id})`);
  } else {
    const inserted = await db
      .insert(users)
      .values({ email: DEMO_EMAIL, name: DEMO_NAME, password: hash, emailVerified: new Date() })
      .returning();
    user = inserted[0];
    console.log(`Created demo user (${user.id})`);
  }

  // Reset the demo watchlist to a clean default set every time.
  await db.delete(watchlists).where(eq(watchlists.userId, user.id));
  for (const cik of DEMO_CIKS) {
    await db
      .insert(watchlists)
      .values({ userId: user.id, cik })
      .onConflictDoNothing();
  }

  console.log(
    `\n✅ Demo ready → ${DEMO_EMAIL} / ${DEMO_PASSWORD}  (${DEMO_CIKS.length} watchlisted carriers)`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("Demo seed failed:", e);
  process.exit(1);
});
