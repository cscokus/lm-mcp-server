import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadTools } from "./read.js";
import { registerProposeTools } from "./propose.js";

/**
 * Register every tool on the server. v1 = READ + PROPOSE.
 * EXECUTE tools (apply_approved_action, get_action_status) are added in a later
 * phase once the CRM Action_Queue and the WebPages tool wiring are in place.
 */
export function registerAllTools(server: McpServer): void {
  registerReadTools(server);
  registerProposeTools(server);
}
