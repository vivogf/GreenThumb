import { type Server } from "node:http";

import express, { type Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import { registerRoutes } from "./routes";
import { storage } from "./storage";
import { createHealthHandler, readRevision, DEFAULT_REVISION_FILE } from "./health";
import { jsonBodyParser, jsonErrorHandler, urlencodedBodyParser } from "./http";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export const app = express();

// nginx terminates TLS in front of Express; secure cookies need the forwarded proto.
app.set('trust proxy', 1);

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

app.use(jsonBodyParser);
app.use(urlencodedBodyParser);

// Registered before the session middleware so it answers even when the session store is down.
app.get("/api/health", createHealthHandler({
  pingDb: () => storage.ping(),
  readRevision: () => readRevision(process.env.REVISION_FILE || DEFAULT_REVISION_FILE),
}));

const PgStore = connectPgSimple(session);
app.use(session({
  secret: process.env.SESSION_SECRET || 'greenthumb-secret-key-development',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: 'auto',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  },
  store: new PgStore({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15,
  }),
}));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

export default async function runApp(
  setup: (app: Express, server: Server) => Promise<void>,
) {
  const server = await registerRoutes(app);

  app.use(jsonErrorHandler);

  // importantly run the final setup after setting up all the other routes so
  // the catch-all route doesn't interfere with the other routes
  await setup(app, server);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: process.env.HOST ?? "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
}
