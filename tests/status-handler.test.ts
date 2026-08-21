import { describe, it, expect, vi, afterEach } from "vitest";
import statusHandler from "../api/status";

function mockRes() {
  const r: any = {
    statusCode: 200,
    body: null,
    setHeader: vi.fn(),
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    end() { return this; },
  };
  return r;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("GET /api/status", () => {
  it("returns 503 when GOOGLE_TOKEN_JSON missing", async () => {
    vi.stubGlobal("process", { ...process, env: {} });
    const req = { method: "GET" };
    const res = mockRes();
    await statusHandler(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  it("returns 503 when GOOGLE_TOKEN_JSON is invalid JSON", async () => {
    vi.stubGlobal("process", { ...process, env: { GOOGLE_TOKEN_JSON: "not json" } });
    const req = { method: "GET" };
    const res = mockRes();
    await statusHandler(req, res);
    expect(res.statusCode).toBe(503);
  });

  it("returns 200 ok:true when token is readable", async () => {
    vi.stubGlobal("process", {
      ...process,
      env: {
        GOOGLE_TOKEN_JSON: JSON.stringify({
          token: "x",
          refresh_token: "rt",
          client_id: "cid",
          client_secret: "cs",
          expiry: new Date(Date.now() + 3600_000).toISOString(),
        }),
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const req = { method: "GET" };
    const res = mockRes();
    await statusHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
