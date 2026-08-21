import { describe, it, expect, vi, afterEach } from "vitest";
import handler from "../api/status";

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    setHeader: vi.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/status", () => {
  it("returns ok=true when GOOGLE_TOKEN_JSON configured and valid", async () => {
    vi.stubGlobal("process", {
      ...process,
      env: {
        GOOGLE_TOKEN_JSON: JSON.stringify({ token: "t", refresh_token: "rt", client_id: "c", client_secret: "s" }),
      },
    });
    const res = mockRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns ok=false when GOOGLE_TOKEN_JSON missing", async () => {
    vi.stubGlobal("process", { ...process, env: {} });
    const res = mockRes();
    await handler({ method: "GET" }, res);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain("GOOGLE_TOKEN_JSON");
  });

  it("returns ok=false when token json invalid", async () => {
    vi.stubGlobal("process", { ...process, env: { GOOGLE_TOKEN_JSON: "not-json{{{" } });
    const res = mockRes();
    await handler({ method: "GET" }, res);
    expect(res.body.ok).toBe(false);
  });
});
