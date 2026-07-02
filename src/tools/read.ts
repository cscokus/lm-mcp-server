import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { crm } from "../clients/crmClient.js";
import { ok, fail } from "./util.js";

/**
 * READ tools — pull from the truth ledger via the CRM API. No side effects.
 *
 * NOTE: `list_clients`, `resolve_client`, and `get_series_performance` are wired
 * to endpoints confirmed in the CRM (routes/series.js). `get_campaign_performance`,
 * `list_tasks`, and `run_ad_review` map to /api/campaigns, /api/tasks, /api/ad-review
 * respectively — verify their exact query/body params against those routes and
 * tighten the schemas below before relying on them.
 */
export function registerReadTools(server: McpServer): void {
  server.registerTool(
    "list_clients",
    {
      title: "List clients",
      description:
        "Return all clients with clientId and clientName. Use as a browse list or as the source for resolving a name to an ID.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await crm.get("/api/series/clients"));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "resolve_client",
    {
      title: "Resolve a client name to an ID",
      description:
        "Given a partial or full client name (as an account manager might type it), return matching clients with their clientId. Returns ALL candidates when the match is ambiguous — confirm which one the user means before proposing any action.",
      inputSchema: {
        name: z.string().describe("Full or partial client name to search for"),
      },
    },
    async ({ name }) => {
      try {
        const clients = (await crm.get("/api/series/clients")) as Array<{
          clientId: number;
          clientName: string;
        }>;
        const needle = name.trim().toLowerCase();
        const matches = clients.filter((c) => c.clientName?.toLowerCase().includes(needle));
        return ok({ query: name, matchCount: matches.length, matches });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "get_series_performance",
    {
      title: "Get per-series performance for a client",
      description:
        "Return spend per series (SP + AMG + DSP), month-to-date spend, monthly budget, and budget-lock state for a client over a date range. Reads the truth ledger. Dates are YYYY-MM-DD; omit them to use the app's default range.",
      inputSchema: {
        clientId: z
          .number()
          .int()
          .describe("Client ID — call resolve_client first if you only have a name"),
        dateStart: z.string().optional().describe("Start date YYYY-MM-DD"),
        dateEnd: z.string().optional().describe("End date YYYY-MM-DD"),
      },
    },
    async ({ clientId, dateStart, dateEnd }) => {
      try {
        return ok(await crm.get("/api/series", { clientId, dateStart, dateEnd }));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "get_campaign_performance",
    {
      title: "Get campaign-level performance for a client",
      description:
        "Return campaign-level metrics (spend, sales, KENP royalties, KENPACOS, ROAS, health flags) for a client. Maps to CRM /api/campaigns — verify query params against that route.",
      inputSchema: {
        clientId: z.number().int().optional(),
        dateStart: z.string().optional(),
        dateEnd: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return ok(await crm.get("/api/campaigns", args));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List open tasks / flags",
      description:
        "Return tasks/flags from the CRM. Maps to /api/tasks — adjust filters to that route's supported query params.",
      inputSchema: {
        clientId: z.number().int().optional(),
        status: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return ok(await crm.get("/api/tasks", args));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "run_ad_review",
    {
      title: "Run an ad-review metric filter",
      description:
        "Query ads/entities matching metric thresholds (spend, sales, clicks, roas) over a date range. Mirrors the CRM Ad Review tool. `filters` is an array of {metric, operator, value, value2?}.",
      inputSchema: {
        dateStart: z.string().optional(),
        dateEnd: z.string().optional(),
        filters: z
          .array(
            z.object({
              metric: z.string(),
              operator: z.string(),
              value: z.union([z.string(), z.number()]).optional(),
              value2: z.union([z.string(), z.number()]).optional(),
            }),
          )
          .optional(),
      },
    },
    async (args) => {
      try {
        return ok(await crm.post("/api/ad-review", args));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
