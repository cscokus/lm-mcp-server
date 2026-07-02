import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export const config = {
  port: parseInt(process.env.PORT ?? "8930", 10),

  // Bearer token expected from the connecting MCP client (Claude Cowork).
  mcpAuthToken: required("MCP_AUTH_TOKEN"),

  crm: {
    baseUrl: stripTrailingSlash(required("CRM_BASE_URL")),
    serviceToken: optional("CRM_SERVICE_TOKEN"),
  },

  // Reserved for the EXECUTE phase — not wired to any tool in v1.
  webTools: {
    baseUrl: stripTrailingSlash(optional("WEBTOOLS_BASE_URL")),
    serviceToken: optional("WEBTOOLS_SERVICE_TOKEN"),
  },
} as const;
