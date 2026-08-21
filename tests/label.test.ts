import { describe, it, expect } from "vitest";
import { buildMatchLabel } from "../api/lib/label";

describe("buildMatchLabel", () => {
  it("appends Tennis sport tag when match has no pipe separator", () => {
    expect(buildMatchLabel("tennis", "Alcaraz v Sinner 17/08/2026")).toBe(
      "Alcaraz v Sinner 17/08/2026 | Tennis - Flashscore | Match"
    );
  });

  it("appends Football sport tag for soccer matches", () => {
    expect(buildMatchLabel("soccer", "Vietnam v Thailand 17/08/2026")).toBe(
      "Vietnam v Thailand 17/08/2026 | Football - Flashscore | Match"
    );
  });

  it("keeps an already-formatted label unchanged", () => {
    const existing = "SHE 0-2 FAR | Ben Shelton v Jaime Faria 16/08/2026 | Tennis - Flashscore | Match";
    expect(buildMatchLabel("tennis", existing)).toBe(existing);
  });

  it("appends tag when label contains pipe but no sport tag yet", () => {
    expect(buildMatchLabel("tennis", "VERCEL TEST | Deploy Test v Pipeline 17/08/2026")).toBe(
      "VERCEL TEST | Deploy Test v Pipeline 17/08/2026 | Tennis - Flashscore | Match"
    );
  });

  it("defaults unknown sport to Tennis tag", () => {
    expect(buildMatchLabel("basketball", "Team A v Team B 01/01/2026")).toBe(
      "Team A v Team B 01/01/2026 | Tennis - Flashscore | Match"
    );
  });
});
