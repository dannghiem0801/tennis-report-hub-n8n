/**
 * Server-only bridge between an agent/tool caller and RapidAPI MCP.
 *
 * This endpoint is deliberately narrow: callers can invoke only tools named
 * in RAPID_MCP_ALLOWED_TOOLS, at most RAPID_MCP_MAX_CALLS times per request.
 * It returns bounded, timestamped evidence suitable for a later report
 * evidence envelope. It never returns credentials or MCP connection headers.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  compactToolResult,
  getRapidMcpConfig,
  RapidMcpClient,
  RapidMcpError,
} from "./rapidapi.js";

// Point-by-point is the one report input that can legitimately exceed the
// normal evidence snippet size. Keep enough of it to parse the JSON; the
// browser normalizes it into a much smaller tactical timeline before LLM use.
const POINT_BY_POINT_MAX_CHARS = 32_000;

interface RequestedTool {
  name: string;
  arguments: Record<string, unknown>;
  optional: boolean;
}

export function resolveRequestedToolName(
  requestedName: string,
  allowedTools: string[],
  availableTools: Set<string>
): string | null {
  return allowedTools.includes(requestedName) && availableTools.has(requestedName)
    ? requestedName
    : null;
}

function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function parseRequestedTools(body: unknown, maxCalls: number): RequestedTool[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RapidMcpError("Body phải là JSON object.", 400);
  }
  const requests = (body as { requests?: unknown }).requests;
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > maxCalls) {
    throw new RapidMcpError(`requests phải có từ 1 đến ${maxCalls} tool call.`, 400);
  }

  return requests.map((request, index) => {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new RapidMcpError(`requests[${index}] không hợp lệ.`, 400);
    }
    const { name, arguments: args, optional } = request as {
      name?: unknown;
      arguments?: unknown;
      optional?: unknown;
    };
    if (typeof name !== "string" || !name.trim() || name.length > 128) {
      throw new RapidMcpError(`requests[${index}].name không hợp lệ.`, 400);
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new RapidMcpError(`requests[${index}].arguments phải là object.`, 400);
    }
    if (JSON.stringify(args).length > 8_000) {
      throw new RapidMcpError(`requests[${index}].arguments quá lớn.`, 400);
    }
    if (optional !== undefined && typeof optional !== "boolean") {
      throw new RapidMcpError(`requests[${index}].optional phải là boolean.`, 400);
    }
    return {
      name: name.trim(),
      arguments: args as Record<string, unknown>,
      optional: optional === true,
    };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed; use POST" });
    return;
  }

  try {
    const config = getRapidMcpConfig();
    const requests = parseRequestedTools(req.body, config.maxCallsPerRequest);
    const client = new RapidMcpClient(config);
    await client.initialize();
    const availableTools = new Set((await client.listTools()).map((tool) => tool.name));
    const fetchedAt = new Date().toISOString();

    const results: Array<{
      evidenceId: string;
      toolName: string;
      fetchedAt: string;
      verified: boolean;
      content: string;
    }> = [];
    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index];
      const toolName = resolveRequestedToolName(request.name, config.allowedTools, availableTools);
      if (!toolName) {
        if (request.optional) continue;
        throw new RapidMcpError(`Tool MCP không được cấu hình hoặc không được phép: ${request.name}`, 403);
      }
      const result = await client.callTool(toolName, request.arguments);
      results.push({
        evidenceId: `mcp-${index}`,
        toolName,
        fetchedAt,
        verified: !result.isError,
        content: compactToolResult(
          result,
          toolName === "Get_Match_Point_by_Point" ? POINT_BY_POINT_MAX_CHARS : undefined,
        ),
      });
    }

    res.status(200).json({ results });
  } catch (error) {
    const known = error instanceof RapidMcpError ? error : new RapidMcpError("Rapid MCP enrichment thất bại.");
    // eslint-disable-next-line no-console
    console.error(`[api/mcp/enrich] ${known.status} ${known.message}`);
    res.status(known.status).json({ error: known.message });
  }
}
