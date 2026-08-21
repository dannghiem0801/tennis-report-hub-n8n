import { describe, it, expect } from "vitest";
import type { Settings } from "../src/types";

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    pollingIntervalMinutes: 0,
    defaultTemplateId: "default",
    timezone: "Asia/Ho_Chi_Minh",
    notificationsEnabled: true,
    llm: undefined,
    backendEnabled: true,
    ...overrides,
  };
}

describe("Settings backendEnabled", () => {
  it("default backendEnabled is undefined (pipeline off by default)", () => {
    const s = makeSettings({ backendEnabled: undefined });
    expect(s.backendEnabled).toBeUndefined();
  });

  it("backendEnabled true enables auto-submit", () => {
    const s = makeSettings({ backendEnabled: true });
    expect(s.backendEnabled).toBe(true);
  });

  it("backendEnabled false disables auto-submit", () => {
    const s = makeSettings({ backendEnabled: false });
    expect(s.backendEnabled).toBe(false);
  });
});
