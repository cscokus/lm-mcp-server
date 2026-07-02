import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

/**
 * Build a fresh McpServer with all tools registered. Called once per MCP session
 * (each streamable-HTTP session gets its own server + transport pair).
 */
export function buildServer(): McpServer {
  const server = new McpServer({ name: "lm-mcp", version: "0.1.0" });
  registerAllTools(server);
  return server;
}
