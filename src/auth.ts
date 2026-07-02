import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Guards the /mcp endpoints. Cloudflare handles TLS + WAF + rate limiting at the
 * edge; this is the application-level identity check. The MCP protocol client
 * (Claude Cowork) must present `Authorization: Bearer <MCP_AUTH_TOKEN>`.
 */
export function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !safeEqual(match[1], config.mcpAuthToken)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }
  next();
}
