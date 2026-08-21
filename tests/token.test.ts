import { describe, it, expect, vi, afterEach } from "vitest";
import { getAccessToken } from "../api/lib/token";

const VALID_CREDS = {
  token: "old-access-token",
  refresh_token: "rt-123",
  client_id: "cid",
  client_secret: "csecret",
  token_uri: "https://oauth2.googleapis.com/token",
  expiry: new Date(Date.now() + 3600_000).toISOString(),
  account: "duc.mnghiem@gmail.com",
};

function stubEnv(creds: unknown): void {
  vi.stubGlobal("process", {
    ...process,
    env: { GOOGLE_TOKEN_JSON: JSON.stringify(creds) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getAccessToken", () => {
  it("returns existing token when not expired (no network call)", async () => {
    stubEnv(VALID_CREDS);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getAccessToken();
    expect(result.token).toBe("old-access-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes via token endpoint when token expired", async () => {
    const expired = { ...VALID_CREDS, token: "expired-token", expiry: new Date(Date.now() - 60_000).toISOString() };
    stubEnv(expired);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "fresh-token" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAccessToken();
    expect(result.token).toBe("fresh-token");
    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-123");
  });

  it("throws clear error when GOOGLE_TOKEN_JSON missing", async () => {
    vi.stubGlobal("process", { ...process, env: {} });
    await expect(getAccessToken()).rejects.toThrow("GOOGLE_TOKEN_JSON");
  });

  it("throws when refresh endpoint returns non-ok", async () => {
    stubEnv({ ...VALID_CREDS, expiry: new Date(Date.now() - 60_000).toISOString() });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad request" }));
    await expect(getAccessToken()).rejects.toThrow(/400/);
  });
});
