import { config } from "../config.js";

/**
 * Reserved for the EXECUTE phase.
 *
 * Thin client for the LiquidMindWebPages PHP tool endpoints (Quick Campaign Tool,
 * Audience Tool, etc.). Those endpoints are form-POST + session/Bearer shaped, so
 * this speaks x-www-form-urlencoded. NOTHING in v1 calls this — v1 is READ +
 * PROPOSE only. When you wire `apply_approved_action`, its handler will look up an
 * APPROVED Action_Queue row and route here. See README "Roadmap".
 */
export const webTools = {
  baseUrl: config.webTools.baseUrl,

  async postForm(path: string, form: Record<string, string>): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (config.webTools.serviceToken) headers["Authorization"] = `Bearer ${config.webTools.serviceToken}`;

    const response = await fetch(config.webTools.baseUrl + path, {
      method: "POST",
      headers,
      body: new URLSearchParams(form).toString(),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`WebTools POST ${path} failed: ${response.status}`);
    return text;
  },
};
