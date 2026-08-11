/**
 * Minimal Streamable HTTP MCP client for RapidAPI.
 *
 * RapidAPI's Playground provides an application-specific URL and host-routing
 * configuration. Keep both that configuration and the subscription key in
 * server-only environment variables; this module must never be imported by
 * browser code.
 */

export interface RapidMcpConfig {
  url: string;
  apiKey: string;
  allowedTools: string[];
  extraHeaders: Record<string, string>;
  maxCallsPerRequest: number;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

interface JsonRpcResponse<T> {
  jsonrpc?: string;
  id?: string | number | null;
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
}

export class RapidMcpError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "RapidMcpError";
    this.status = status;
  }
}

const DEFAULT_URL = "https://mcp.rapidapi.com";
const DEFAULT_MAX_CALLS = 2;
const MAX_CALLS = 4;
const REQUEST_TIMEOUT_MS = 15_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_CALLS);
}

function parseExtraHeaders(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RapidMcpError("RAPID_MCP_REQUEST_HEADERS phải là JSON object hợp lệ.", 500);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RapidMcpError("RAPID_MCP_REQUEST_HEADERS phải là JSON object.", 500);
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    const normalizedName = name.toLowerCase();
    // RapidAPI's MCP setup may need a routing header. Do not let env config
    // override protocol headers or inject arbitrary network-control headers.
    if (
      (normalizedName !== "x-api-host" && !/^x-rapidapi-[a-z0-9-]+$/.test(normalizedName)) ||
      normalizedName === "x-api-key" ||
      normalizedName === "x-rapidapi-key" ||
      typeof value !== "string" ||
      !value.trim()
    ) {
      throw new RapidMcpError(
        "RAPID_MCP_REQUEST_HEADERS chỉ nhận x-api-host hoặc x-rapidapi-* không rỗng (trừ header key).",
        500
      );
    }
    headers[normalizedName] = value.trim();
  }
  return headers;
}

export function getRapidMcpConfig(env: NodeJS.ProcessEnv = process.env): RapidMcpConfig {
  if (env.RAPID_MCP_ENABLED !== "true") {
    throw new RapidMcpError("Rapid MCP chưa được bật trên máy chủ.", 503);
  }

  const apiKey = env.RAPID_MCP_API_KEY ?? env.RAPID_API_KEY;
  if (!apiKey) {
    throw new RapidMcpError("Máy chủ chưa có RAPID_MCP_API_KEY.", 500);
  }

  const allowedTools = (env.RAPID_MCP_ALLOWED_TOOLS ?? "")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);

  const url = (env.RAPID_MCP_URL ?? DEFAULT_URL).trim().replace(/\/+$/, "");
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new RapidMcpError("RAPID_MCP_URL phải là HTTP(S) URL hợp lệ.", 500);
  }

  return {
    url,
    apiKey,
    allowedTools,
    extraHeaders: parseExtraHeaders(env.RAPID_MCP_REQUEST_HEADERS),
    maxCallsPerRequest: parsePositiveInt(env.RAPID_MCP_MAX_CALLS, DEFAULT_MAX_CALLS),
  };
}

function parseJsonRpcResponse<T>(text: string): JsonRpcResponse<T> {
  try {
    const parsed = JSON.parse(text) as JsonRpcResponse<T>;
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed;
  } catch {
    throw new RapidMcpError("Rapid MCP trả về JSON-RPC không hợp lệ.");
  }
}

function responseError(response: JsonRpcResponse<unknown>): RapidMcpError | null {
  if (!response.error) return null;
  return new RapidMcpError(
    `Rapid MCP lỗi${response.error.code !== undefined ? ` (${response.error.code})` : ""}: ${response.error.message ?? "không xác định"}`,
    502
  );
}

export class RapidMcpClient {
  private nextId = 1;

  constructor(
    private readonly config: RapidMcpConfig,
    private readonly requestTimeoutMs = REQUEST_TIMEOUT_MS
  ) {}

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const id = this.nextId++;

    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          ...this.config.extraHeaders,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new RapidMcpError(`Rapid MCP trả về HTTP ${response.status}.`, response.status);
      }

      const parsed = parseJsonRpcResponse<T>(text);
      const rpcError = responseError(parsed);
      if (rpcError) throw rpcError;
      if (parsed.result === undefined) {
        throw new RapidMcpError("Rapid MCP không trả về kết quả cho yêu cầu.");
      }
      return parsed.result;
    } catch (error) {
      if (error instanceof RapidMcpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new RapidMcpError("Rapid MCP không phản hồi trước thời hạn.", 504);
      }
      throw new RapidMcpError(
        `Không thể kết nối Rapid MCP: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async notify(method: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          ...this.config.extraHeaders,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new RapidMcpError(`Rapid MCP trả về HTTP ${response.status}.`, response.status);
      }
    } catch (error) {
      if (error instanceof RapidMcpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new RapidMcpError("Rapid MCP không phản hồi trước thời hạn.", 504);
      }
      throw new RapidMcpError(
        `Không thể kết nối Rapid MCP: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "tennis-report-hub", version: "1.0.0" },
    });
    await this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request<{ tools?: McpToolDefinition[] }>("tools/list");
    return Array.isArray(result.tools) ? result.tools : [];
  }

  async callTool(name: string, argumentsValue: Record<string, unknown>): Promise<McpToolResult> {
    if (this.config.allowedTools.length === 0) {
      throw new RapidMcpError("RAPID_MCP_ALLOWED_TOOLS chưa được cấu hình.", 503);
    }
    if (!this.config.allowedTools.includes(name)) {
      throw new RapidMcpError(`Tool MCP không được phép: ${name}`, 403);
    }
    return this.request<McpToolResult>("tools/call", { name, arguments: argumentsValue });
  }

  getMaxCallsPerRequest(): number {
    return this.config.maxCallsPerRequest;
  }
}

export function compactToolResult(result: McpToolResult, maxChars = 8_000): string {
  const text = result.content
    .map((item) => {
      if (typeof item.text === "string") return item.text;
      return JSON.stringify(item);
    })
    .join("\n")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[Đã cắt bớt kết quả MCP]` : text;
}
