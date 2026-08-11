/** Read-only MCP catalog probe. Use it once after configuration to choose the
 * explicit RAPID_MCP_ALLOWED_TOOLS allowlist; it never invokes an API tool. */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRapidMcpConfig, RapidMcpClient, RapidMcpError } from "./rapidapi";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed; use GET" });
    return;
  }

  try {
    const client = new RapidMcpClient(getRapidMcpConfig());
    await client.initialize();
    const tools = await client.listTools();
    res.status(200).json({
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? "" })),
    });
  } catch (error) {
    const known = error instanceof RapidMcpError ? error : new RapidMcpError("Không thể đọc MCP tool catalog.");
    // eslint-disable-next-line no-console
    console.error(`[api/mcp/tools] ${known.status} ${known.message}`);
    res.status(known.status).json({ error: known.message });
  }
}
