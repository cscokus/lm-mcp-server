import { config } from "../config.js";

type Query = Record<string, string | number | boolean | undefined>;
type Method = "GET" | "POST" | "PATCH";

function buildUrl(path: string, query?: Query): string {
  const url = new URL(config.crm.baseUrl + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request(method: Method, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.crm.serviceToken) headers["Authorization"] = `Bearer ${config.crm.serviceToken}`;

  const response = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Leave as raw text if the body is not JSON.
  }

  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new Error(`CRM ${method} ${path} failed: ${detail}`);
  }

  return data;
}

/** Thin HTTP client for the Liquid-Mind-CRM Express API. Holds no business logic. */
export const crm = {
  get: (path: string, query?: Query) => request("GET", path, { query }),
  post: (path: string, body?: unknown) => request("POST", path, { body }),
  patch: (path: string, body?: unknown) => request("PATCH", path, { body }),
};
