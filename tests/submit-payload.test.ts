import { describe, it, expect } from "vitest";
import { buildSubmitPayload } from "../src/lib/submit-payload";
import type { Match } from "../src/types";

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    tournamentId: "t1",
    tournamentName: "Cincinnati Open — ATP Masters 1000",
    tournamentCategory: "ATP Masters 1000",
    round: "R2",
    startTime: "2026-08-17T10:00:00+07:00",
    status: "completed",
    player1: { name: "B. Shelton", fullName: "Ben Shelton", country: "US", countryFlag: "🇺🇸", ranking: 8, seed: 8 },
    player2: { name: "J. Faria", fullName: "Jaime Faria", country: "PT", countryFlag: "🇵🇹", ranking: 79 },
    sets: [
      { player1: 6, player2: 4 },
      { player1: 6, player2: 4 },
    ],
    setsWon: { player1: 2, player2: 0 },
    ...overrides,
  };
}

describe("buildSubmitPayload", () => {
  it("builds tennis payload with player names + date and no youtube link", () => {
    const payload = buildSubmitPayload(makeMatch(), "tennis");
    expect(payload.sport).toBe("tennis");
    expect(payload.match).toContain("Ben Shelton v Jaime Faria");
    expect(payload.match).toContain("17/08/2026");
    expect(payload.youtube_link).toBe("");
  });

  it("includes score code when setsWon available", () => {
    const payload = buildSubmitPayload(makeMatch(), "tennis");
    expect(payload.match).toMatch(/Shelton 2-0 Faria|^[A-Z]+ 2-0 [A-Z]+/);
  });

  it("includes the tennis Flashscore tag", () => {
    const payload = buildSubmitPayload(makeMatch(), "tennis");
    expect(payload.match).toContain("Tennis - Flashscore");
  });

  it("uses soccer tag for soccer sport", () => {
    const payload = buildSubmitPayload(makeMatch(), "soccer");
    expect(payload.match).toContain("Football - Flashscore");
  });

  it("does not crash when match has no sets yet", () => {
    const m = makeMatch({ sets: undefined, setsWon: undefined, status: "scheduled" });
    const payload = buildSubmitPayload(m, "tennis");
    expect(payload.match).toContain("Ben Shelton v Jaime Faria");
  });
});
