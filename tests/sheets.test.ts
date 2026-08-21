import { describe, it, expect, vi, afterEach } from "vitest";
import { readTab, appendRow } from "../api/lib/sheets";

const FAKE_TOKEN = "fake-access-token";

function stubToken(): void {
  vi.stubGlobal("process", {
    ...process,
    env: {
      GOOGLE_TOKEN_JSON: JSON.stringify({
        token: FAKE_TOKEN,
        refresh_token: "rt",
        client_id: "cid",
        client_secret: "cs",
        expiry: new Date(Date.now() + 3600_000).toISOString(),
      }),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readTab", () => {
  it("parses header + rows into objects with row_index", async () => {
    stubToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          values: [
            ["Match", "Link Youtube", "Status", "Report", "Drive"],
            ["A v B 01/01", "", "Done", "Nội dung", "https://drive.google.com/x"],
            ["C v D 02/01", "https://youtu.be/abc", "", "", ""],
          ],
        }),
      })
    );

    const rows = await readTab("Tennis");
    expect(rows).toHaveLength(2);
    expect(rows[0].row_index).toBe(2);
    expect(rows[0].Match).toBe("A v B 01/01");
    expect(rows[0].Status).toBe("Done");
    expect(rows[1].row_index).toBe(3);
    expect(rows[1]["Link Youtube"]).toBe("https://youtu.be/abc");
  });

  it("returns empty array when sheet has no values", async () => {
    stubToken();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await readTab("Tennis")).toEqual([]);
  });

  it("throws when Sheets API returns error", async () => {
    stubToken();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "forbidden" })
    );
    await expect(readTab("Tennis")).rejects.toThrow(/403/);
  });
});

describe("appendRow", () => {
  it("appends with USER_ENTERED and returns last row number from updatedRange", async () => {
    stubToken();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ updates: { updatedRange: "Tennis!A2:B2" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const rowIndex = await appendRow("Tennis", "E v F 03/01 | Tennis - Flashscore | Match", "https://youtu.be/xyz");
    expect(rowIndex).toBe(2);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("Tennis!A:B:append");
    expect(url).toContain("valueInputOption=USER_ENTERED");
    // Header Authorization dùng token
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("returns 0 when updatedRange missing", async () => {
    stubToken();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await appendRow("Tennis", "M v N", "")).toBe(0);
  });
});
