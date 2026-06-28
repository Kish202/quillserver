import {
  pgTable,
  text,
  timestamp,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";

// Reuses the existing Neon tables created by the Next.js build.
// (The unused Auth.js tables — account/session/verificationToken — are left alone.)

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  // bcrypt hash for email/password sign-in (null for Google-only users)
  password: text("password"),
});

export const watchlists = pgTable(
  "watchlist",
  {
    userId: text("userId").notNull(),
    cik: text("cik").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (w) => [primaryKey({ columns: [w.userId, w.cik] })]
);

// One row per user — their alert configuration.
export const alertPrefs = pgTable("alert_prefs", {
  userId: text("userId").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  watchlistOnly: boolean("watchlistOnly").notNull().default(true),
  forms: text("forms").notNull().default("8-K,10-K"),
  frequency: text("frequency").notNull().default("realtime"), // realtime | daily | weekly
  email: text("email"), // delivery address (defaults to the account email)
  lastDigestAt: timestamp("lastDigestAt", { mode: "date" }),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow(),
});

// Dedup: which filings have already been alerted to which user (realtime).
export const alertSent = pgTable(
  "alert_sent",
  {
    userId: text("userId").notNull(),
    accession: text("accession").notNull(),
    sentAt: timestamp("sentAt", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.accession] })]
);

export type User = typeof users.$inferSelect;
export type AlertPrefs = typeof alertPrefs.$inferSelect;
