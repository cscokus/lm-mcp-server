import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { requireBearer } from "./auth.js";
import { buildServer } from "./server.js";

const app = express();
app.use(express.json());

// Unauthenticated health check — used by the droplet / Cloudflare Tunnel.
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-mcp", version: "0.1.0" });
});

// Active streamable-HTTP transports, keyed by MCP session id.
const transports: Record<string, StreamableHTTPServerTransport> = {};

// Client → server messages (initialize + tool calls).
app.post("/mcp", requireBearer, async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session id" },
        id: null,
      });
      return;
    }

    const created = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = created;
      },
    });
    created.onclose = () => {
      if (created.sessionId) delete transports[created.sessionId];
    };
    await buildServer().connect(created);
    transport = created;
  }

  await transport.handleRequest(req, res, req.body);
});

// Server → client stream (GET) and session teardown (DELETE).
async function handleSessionRequest(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session id");
    return;
  }
  await transport.handleRequest(req, res);
}

app.get("/mcp", requireBearer, handleSessionRequest);
app.delete("/mcp", requireBearer, handleSessionRequest);

app.listen(config.port, () => {
  console.log(`lm-mcp listening on :${config.port} (CRM → ${config.crm.baseUrl})`);
});
