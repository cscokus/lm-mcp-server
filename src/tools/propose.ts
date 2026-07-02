import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { crm } from "../clients/crmClient.js";
import { ok, fail } from "./util.js";

/**
 * PROPOSE tools — write a row to the CRM Action_Queue. They NEVER touch a campaign.
 *
 * Every tool here POSTs to `POST /api/actions` on the CRM, which inserts a row in
 * `status = 'proposed'`. A human approves/denies it in the WebPages UI; only the
 * (future) `apply_approved_action` tool executes an APPROVED row. See the README
 * "CRM-side contract" — this endpoint + the Action_Queue table must exist CRM-side.
 */

const PLATFORM = z.enum(["AMS", "AMG", "DSP", "FB"]);

/** Fields common to every proposal. */
const base = {
  clientId: z.number().int().describe("Client ID (resolve_client first if needed)"),
  seriesASIN: z.string().optional().describe("Series ASIN this action targets, if series-scoped"),
  platform: PLATFORM,
  rationale: z.string().describe("Why this action — the argument a human approves"),
  expectedImpactUsd: z.number().optional().describe("Expected monthly $ contribution impact"),
  modelBasis: z.string().optional().describe("The economic basis (ceiling, KU ratio, lookback, etc.)"),
};

type Envelope = {
  actionType: string;
  clientId: number;
  seriesASIN?: string;
  platform: string;
  rationale: string;
  expectedImpactUsd?: number;
  modelBasis?: string;
  currentValue?: unknown;
  proposedValue?: unknown;
};

async function createProposal(envelope: Envelope) {
  return crm.post("/api/actions", { ...envelope, proposedBy: "claude" });
}

export function registerProposeTools(server: McpServer): void {
  server.registerTool(
    "propose_bid_change",
    {
      title: "Propose a bid change",
      description:
        "Queue a bid change for human approval. Does not change any bid. Provide the entity reference and the current vs. proposed bid.",
      inputSchema: {
        ...base,
        entityRef: z.string().describe("Campaign / keyword / target the bid applies to (id or name)"),
        currentBid: z.number().describe("Current bid in dollars"),
        proposedBid: z.number().describe("Proposed bid in dollars"),
      },
    },
    async ({ entityRef, currentBid, proposedBid, ...rest }) => {
      try {
        return ok(
          await createProposal({
            actionType: "bid_change",
            ...rest,
            currentValue: { entityRef, bid: currentBid },
            proposedValue: { entityRef, bid: proposedBid },
          }),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "propose_budget_shift",
    {
      title: "Propose a budget shift",
      description:
        "Queue a budget move between campaigns/platforms for human approval. Does not move any budget.",
      inputSchema: {
        ...base,
        fromRef: z.string().describe("Source campaign/platform to move budget from"),
        toRef: z.string().describe("Destination campaign/platform to move budget to"),
        amountUsd: z.number().describe("Amount to shift, in dollars"),
      },
    },
    async ({ fromRef, toRef, amountUsd, ...rest }) => {
      try {
        return ok(
          await createProposal({
            actionType: "budget_shift",
            ...rest,
            currentValue: { fromRef, toRef },
            proposedValue: { fromRef, toRef, amountUsd },
          }),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "propose_audience_rebuild",
    {
      title: "Propose an AMG/DSP audience rebuild",
      description:
        "Queue an audience rebuild (e.g. into the 30Day_M.T.S.-ProductPurchases form) for human approval. Does not build anything.",
      inputSchema: {
        ...base,
        currentAudience: z.string().describe("The existing audience (name + structure)"),
        proposedAudience: z.string().describe("The proposed rebuilt audience name/structure"),
      },
    },
    async ({ currentAudience, proposedAudience, ...rest }) => {
      try {
        return ok(
          await createProposal({
            actionType: "audience_rebuild",
            ...rest,
            currentValue: { audience: currentAudience },
            proposedValue: { audience: proposedAudience },
          }),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "propose_campaign_state",
    {
      title: "Propose a campaign state change",
      description:
        "Queue a pause / enable / restart for human approval. Does not change campaign state.",
      inputSchema: {
        ...base,
        entityRef: z.string().describe("Campaign this applies to (id or name)"),
        currentState: z.string().describe("Current state, e.g. ENABLED / PAUSED"),
        proposedState: z.enum(["pause", "enable", "restart"]),
      },
    },
    async ({ entityRef, currentState, proposedState, ...rest }) => {
      try {
        return ok(
          await createProposal({
            actionType: "campaign_state",
            ...rest,
            currentValue: { entityRef, state: currentState },
            proposedValue: { entityRef, state: proposedState },
          }),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "propose_new_campaign",
    {
      title: "Propose a new campaign build",
      description:
        "Queue a new campaign build for human approval (routes to the Quick Campaign Tool on approval). Does not build anything. `spec` is an opaque object describing the build.",
      inputSchema: {
        ...base,
        spec: z.record(z.any()).describe("Campaign build spec (matches Quick Campaign Tool inputs)"),
      },
    },
    async ({ spec, ...rest }) => {
      try {
        return ok(
          await createProposal({
            actionType: "new_campaign",
            ...rest,
            proposedValue: { spec },
          }),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
