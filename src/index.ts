import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createMcpServer } from "./server.js";
import { type RequestKeys } from "./keys.js";
import { LANDING_HTML } from "./landing.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const PATH = process.env.MCP_PATH ?? "/mcp";

// SCR-14: CORS allowlist — extend via CORS_ORIGINS env var (comma-separated)
const CORS_ORIGINS: (string | RegExp)[] = [
  "https://claude.ai",
  "https://app.claude.ai",
  ...(process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

// SCR-11: rate limit per IP — protects WorldTides/Stormglass paid API credits
const mcpRateLimit = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_PER_MIN ?? 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.header("x-forwarded-for")?.split(",")[0].trim() ?? req.ip ?? "unknown",
});

// SCR-12: accept API keys via headers only — query params are logged in plaintext
function extractKeys(req: Request): RequestKeys {
  const windy =
    req.header("x-windy-key") ||
    bearer(req.header("authorization"));
  const worldtides = req.header("x-worldtides-key");
  const stormglass = req.header("x-stormglass-key");
  const aisstream = req.header("x-aisstream-key");
  return { windy, worldtides, stormglass, aisstream };
}

function bearer(h: string | undefined): string | undefined {
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : undefined;
}

const app = express();
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no Origin (e.g. native MCP clients, curl)
      if (!origin) return cb(null, true);
      const allowed = CORS_ORIGINS.some((o) =>
        o instanceof RegExp ? o.test(origin) : o === origin,
      );
      cb(allowed ? null : new Error(`CORS: origin ${origin} not allowed`), allowed);
    },
    methods: ["POST", "GET", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key",
      "X-Windy-Key", "X-WorldTides-Key", "X-Stormglass-Key", "X-AISStream-Key"],
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res
    .type("text/html; charset=utf-8")
    .set("cache-control", "public, max-age=300")
    .send(LANDING_HTML);
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

const handleMcp = async (req: Request, res: Response) => {
  const keys = extractKeys(req);
  const server = createMcpServer(keys);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : "Internal error",
        },
        id: null,
      });
    }
  }
};

app.post(PATH, mcpRateLimit, handleMcp);
app.get(PATH, (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed. Use POST." },
    id: null,
  });
});
app.delete(PATH, (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed." },
    id: null,
  });
});

app.listen(PORT, HOST, () => {
  console.log(`windy-mcp listening on http://${HOST}:${PORT}${PATH}`);
});
