import { describe, it, expect } from "vitest";
import { shouldAutoSubmit } from "../src/lib/submit-payload";

describe("shouldAutoSubmit", () => {
  it("returns true when backend enabled and entry pending with completed match", () => {
    expect(shouldAutoSubmit({ backendEnabled: true, entryStatus: "pending", matchStatus: "completed" })).toBe(true);
  });

  it("returns false when backend disabled", () => {
    expect(shouldAutoSubmit({ backendEnabled: false, entryStatus: "pending", matchStatus: "completed" })).toBe(false);
  });

  it("returns false when match not yet completed", () => {
    expect(shouldAutoSubmit({ backendEnabled: true, entryStatus: "pending", matchStatus: "live" })).toBe(false);
  });

  it("returns false when entry already generating", () => {
    expect(shouldAutoSubmit({ backendEnabled: true, entryStatus: "consolidating", matchStatus: "completed" })).toBe(false);
  });

  it("returns false when entry already completed (avoid duplicate submit)", () => {
    expect(shouldAutoSubmit({ backendEnabled: true, entryStatus: "completed", matchStatus: "completed" })).toBe(false);
  });
});
