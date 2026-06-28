import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { passport } from "./auth/google";
import authRoutes from "./routes/auth";
import watchlistRoutes from "./routes/watchlist";
import secRoutes from "./routes/sec";
import alertRoutes from "./routes/alerts";

/** Build the Express app (no listen) — imported by index.ts to serve and by tests. */
export function createApp() {
  const app = express();
  const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

  app.use(cors({ origin: CLIENT_URL, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(passport.initialize());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRoutes);
  app.use("/api/watchlist", watchlistRoutes);
  app.use("/api/alerts", alertRoutes);
  app.use("/api", secRoutes);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("API error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export const app = createApp();
