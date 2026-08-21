import { describe, it, expect } from "vitest";
import { buildSubmitPayload, shouldAutoSubmit } from "../src/lib/submit-payload";
import type { WatchlistEntry, Settings } from "../src/types";

function makeEntry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    id: "e1",
    sport: "tennis",
    matchApiId: "api-123",
    side1Name: "Alcaraz",
    side2Name: "Sinner",
    side1Flag: "🇪🇸",
    side2Flag: "🇮🇹",
    tournamentName: "US Open",
    tournamentCategory: "Grand Slam",
    matchDate: "17/08/2026",
    startTime: "10:00",
    status: "completed",
    createdAt: "2026-08-17T09:00:00Z",
    ...overrides,
  } as WatchlistEntry;
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    pollingIntervalMinutes: 0,
    defaultTemplateId: "default",
    timezone: "Asia/Ho_Chi_Minh",
    notificationsEnabled: true,
    llm: undefined,
    ...overrides,
  };
}

describe("buildSubmitPayload", () => {
  it("builds tennis payload with side1 v side2 and Tennis tag", () => {
    const entry = makeEntry({ side1Name: "Alcaraz", side2Name: "Sinner", matchDate: "17/08/2026" });
    const payload = buildSubmitPayload(entry, "tennis");
    expect(payload.sport).toBe("tennis");
    expect(payload.match).toContain("Alcaraz v Sinner");
    expect(payload.match).toContain("17/08/2026");
    expect(payload.match).toContain("Tennis - Flashscore");
  });

  it("builds soccer payload with Football tag", () => {
    const entry = makeEntry({ sport: "football", side1Name: "Vietnam", side2Name: "Thailand", matchDate: "17/08/2026" });
    const payload = buildSubmitPayload(entry, "football");
    expect(payload.sport).toBe("football");
    expect(payload.match).toContain("Vietnam v Thailand");
    expect(payload.match).toContain("Football - Flashscore");
  });

  it("appends Flashscore tag when label has no sport tag (compatibility)", () => {
    const entry = makeEntry({ side1Name: "Shelton", side2Name: "Faria", matchDate: "16/08/2026" });
    const payload = buildSubmitPayload(entry, "tennis");
    expect(payload.match).toBe("Shelton v Faria 16/08/2026 | Tennis - Flashscore | Match");
  });
});

describe("shouldAutoSubmit", () => {
  it("returns true when backendEnabled and status completed", () => {
    const entry = makeEntry({ status: "completed" });
    const settings = makeSettings({ backendEnabled: true });
    expect(shouldAutoSubmit(entry, settings)).toBe(true);
  });

  it("returns false when status is not completed", () => {
    const entry = makeEntry({ status: "pending" });
    const settings = makeSettings({ backendEnabled: true });
    expect(shouldAutoSubmit(entry, settings)).toBe(false);
  });

  it("returns false when backendEnabled is false", () => {
    const entry = makeEntry({ status: "completed" });
    const settings = makeSettings({ backendEnabled: false });
    expect(shouldAutoSubmit(entry, settings)).toBe(false);
  });

  it("returns false when backendEnabled is undefined (default off)", () => {
    const entry = makeEntry({ status: "completed" });
    const settings = makeSettings({ backendEnabled: undefined });
    expect(shouldAutoSubmit(entry, settings)).toBe(false);
  });
});
