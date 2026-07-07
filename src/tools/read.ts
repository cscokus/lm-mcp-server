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
    "describe_schema",
    {
      title: "Describe the Amazon_Ads_DB schema",
      description:
        "Call this BEFORE composing any SQL with run_db_query. With no arguments it returns the curated schema guide: what every table means, canonical join paths (client→series→campaigns, Client_ASINs→SP_Product_Ad_Performance_Data, etc.), and gotchas (attribution windows, DSP totalCost vs cost, collations). With a table name it returns that table's live column list and indexes from information_schema.",
      inputSchema: {
        table: z
          .string()
          .regex(/^[A-Za-z0-9_]{1,64}$/)
          .optional()
          .describe("Exact table name for live column/index details; omit for the full guide"),
      },
    },
    async ({ table }) => {
      try {
        return ok(await crm.get("/api/db/schema", { table }));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "run_db_query",
    {
      title: "Run a read-only SQL query",
      description:
        "Execute a single SELECT (or WITH...SELECT) against Amazon_Ads_DB for questions no dedicated tool covers. Read the schema guide (describe_schema) first and follow its documented join paths. Results are LIMIT-capped (default 100, max 500) — aggregate in SQL rather than fetching raw rows. If the query errors, the MySQL message is returned so you can correct and retry.",
      inputSchema: {
        sql: z.string().describe("One SELECT statement. No writes, no multiple statements."),
        limit: z.number().int().min(1).max(500).optional().describe("Row cap if the query has no LIMIT (default 100)"),
      },
    },
    async ({ sql, limit }) => {
      try {
        return ok(await crm.post("/api/db/query", { sql, limit }));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "get_asin_performance",
    {
      title: "Get SP performance for specific book ASINs",
      description:
        "Canonical per-ASIN Sponsored Products performance (spend, sales14d, purchases, KENP reads/royalties) from SP_Product_Ad_Performance_Data. Use this instead of hand-writing the query so numbers are consistent. To find a client's ASINs first, query Client_ASINs (via run_db_query) or ask the user.",
      inputSchema: {
        asins: z.array(z.string().regex(/^[A-Z0-9]{10}$/)).min(1).max(50).describe("Book ASINs"),
        dateStart: z.string().optional().describe("YYYY-MM-DD (default 30 days ago)"),
        dateEnd: z.string().optional().describe("YYYY-MM-DD (default today)"),
        groupBy: z.enum(["asin", "day"]).optional().describe("asin (totals, default) or day (daily rows)"),
      },
    },
    async ({ asins, dateStart, dateEnd, groupBy }) => {
      try {
        return ok(
          await crm.get("/api/db/asin-performance", {
            asins: asins.join(","),
            dateStart,
            dateEnd,
            groupBy,
          }),
        );
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
