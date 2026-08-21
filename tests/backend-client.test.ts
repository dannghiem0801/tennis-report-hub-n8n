import { describe, it, expect, vi, afterEach } from "vitest";
import { submitMatch, getMatches, getReportFromRow, getDriveLinkFromRow } from "../src/api/backend";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetchJson(data: unknown, ok = true, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, status, json: async () => data }));
}

describe("submitMatch", () => {
  it("POSTs payload and returns result", async () => {
    stubFetchJson({ row_index: 5, status: "queued", tab: "Tennis" });
    const result = await submitMatch({ sport: "tennis", match: "A v B", youtube_link: "https://youtu.be/x" });
    expect(result.row_index).toBe(5);
    expect(result.status).toBe("queued");

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("/api/matches");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.match).toBe("A v B");
    expect(body.sport).toBe("tennis");
  });

  it("throws with server error message on failure", async () => {
    stubFetchJson({ error: "Thiếu trường 'match'" }, false, 400);
    await expect(submitMatch({ sport: "tennis", match: "" })).rejects.toThrow("Thiếu trường");
  });

  it("throws with HTTP status when body has no error", async () => {
    stubFetchJson({}, false, 500);
    await expect(submitMatch({ sport: "tennis", match: "A" })).rejects.toThrow("HTTP 500");
  });
});

describe("getMatches", () => {
  it("requests Tennis tab by default and returns rows", async () => {
    stubFetchJson({ rows: [{ row_index: 2, Match: "A v B" }] });
    const rows = await getMatches("tennis");
    expect(rows).toHaveLength(1);
    const [url] = (fetch as any).mock.calls[0];
    expect(url).toContain("/api/matches?tab=Tennis");
  });

  it("requests Soccer tab when sport is soccer", async () => {
    stubFetchJson({ rows: [] });
    await getMatches("soccer");
    const [url] = (fetch as any).mock.calls[0];
    expect(url).toContain("tab=Soccer");
  });
});

describe("report helpers", () => {
  const tennisRow = { row_index: 2, Match: "A", "Report (tennis-recap)": "Recap tennis" };
  const soccerRow = { row_index: 2, Match: "B", "Report (soccer-recap)": "Recap bóng đá" };
  const driveRow = { row_index: 3, "Link Google Drive(youtube-to-drive)": "https://drive.google.com/file/d/1/view" };

  it("reads tennis report column for tennis", () => {
    expect(getReportFromRow(tennisRow as any, "tennis")).toBe("Recap tennis");
  });

  it("reads soccer report column for soccer", () => {
    expect(getReportFromRow(soccerRow as any, "soccer")).toBe("Recap bóng đá");
  });

  it("returns empty string when report missing", () => {
    expect(getReportFromRow({ row_index: 2 } as any, "tennis")).toBe("");
  });

  it("extracts drive link", () => {
    expect(getDriveLinkFromRow(driveRow as any)).toBe("https://drive.google.com/file/d/1/view");
  });
});
