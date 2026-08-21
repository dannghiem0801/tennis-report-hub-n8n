import { describe, it, expect, vi, afterEach } from "vitest";
import handler from "../api/matches";

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

describe("POST /api/matches", () => {
  it("appends row to Tennis tab and returns 202 with row_index", async () => {
    vi.stubGlobal("process", {
      ...process,
      env: {
        GOOGLE_TOKEN_JSON: JSON.stringify({
          token: "t",
          refresh_token: "rt",
          client_id: "cid",
          client_secret: "cs",
          expiry: new Date(Date.now() + 3600_000).toISOString(),
        }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ updates: { updatedRange: "Tennis!A2:B2" } }),
      })
    );

    const req = { method: "POST", body: { sport: "tennis", match: "Alcaraz v Sinner 17/08/2026", youtube_link: "https://youtu.be/x" } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(202);
    expect(res.body.row_index).toBe(2);
    expect(res.body.status).toBe("queued");
    expect(res.body.tab).toBe("Tennis");
  });

  it("routes soccer to Soccer tab with Football tag", async () => {
    vi.stubGlobal("process", {
      ...process,
      env: {
        GOOGLE_TOKEN_JSON: JSON.stringify({
          token: "t",
          refresh_token: "rt",
          client_id: "cid",
          client_secret: "cs",
          expiry: new Date(Date.now() + 3600_000).toISOString(),
        }),
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ updates: { updatedRange: "Soccer!A3:B3" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = { method: "POST", body: { sport: "soccer", match: "Vietnam v Thailand 17/08/2026" } };
    const res = mockRes();
    await handler(req, res);

    expect(res.body.tab).toBe("Soccer");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("Soccer!A:B:append");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const sentBody = JSON.parse(init.body as string) as { values: string[][] };
    expect(sentBody.values[0][0]).toContain("Football - Flashscore");
  });

  it("returns 400 when match missing", async () => {
    const req = { method: "POST", body: { sport: "tennis" } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("match");
  });

  it("returns 500 with message when sheet append fails", async () => {
    vi.stubGlobal("process", {
      ...process,
      env: {
        GOOGLE_TOKEN_JSON: JSON.stringify({
          token: "t",
          refresh_token: "rt",
          client_id: "cid",
          client_secret: "cs",
          expiry: new Date(Date.now() + 3600_000).toISOString(),
        }),
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "forbidden" }));
    const req = { method: "POST", body: { match: "A v B" } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toContain("403");
  });
});

describe("GET /api/matches", () => {
  it("reads Tennis tab by default and returns rows", async () => {
    vi.stubGlobal("process", {
      ...process,
      env: {
        GOOGLE_TOKEN_JSON: JSON.stringify({
          token: "t",
          refresh_token: "rt",
          client_id: "cid",
          client_secret: "cs",
          expiry: new Date(Date.now() + 3600_000).toISOString(),
        }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          values: [
            ["Match", "Status", "Report", "Drive"],
            ["A v B", "Done", "Recap A", "https://drive.google.com/1"],
          ],
        }),
      })
    );
    const req = { method: "GET", query: {} };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.tab).toBe("Tennis");
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].Match).toBe("A v B");
  });
});
