---
title: Live prompt validation - Montreal 2026
date: 2026-08-10
status: complete
scope: production UI flow through local Vite proxies
match_id: MuRyYFe2
---

# Live prompt validation report

## Summary

The production UI flow completed for a real finished match: **Botic van de Zandschulp vs Jakub Mensik, Montreal, 10 August 2026**. The app fetched match details and point-by-point data, called the configured LLM with web-search tools, and rendered a Vietnamese report.

**Verdict: the pipeline works, but the generated report is not publication-safe.** Core score facts were correct, while the final prose included a tool-process preamble and match-specific claims that were not supported by the model input. The live run therefore confirms the prompt-architecture concern: rich upstream data is reduced to a lossy aggregate, retrieval failure is not treated as a hard limitation, and no output validator blocks unsupported prose.

## Test results overview

| Check | Result | Evidence |
|---|---|---|
| Production build | Pass | `npm run build` completed; only the existing large-chunk warning remained. |
| Dashboard and live API load | Pass | 71 matches loaded across 15 events; no page error or Vite overlay. |
| Real match selection | Pass | Match `MuRyYFe2`, Mensik won 6-4, 7-5. |
| Point-by-point enrichment | Partial | Two sets and 22 games were fetched, but several stored `gameWinner` values conflict with cumulative scores. |
| LLM report generation | Pass | MiniMax-M3 returned a rendered article after three model turns. |
| External result validation | Pass | Official National Bank Open recap confirms Mensik won 6-4, 7-5 and reached the quarterfinals. |
| Web retrieval inside the product | Fail | Three Firecrawl searches returned no usable results to the model despite HTTP 200 responses. |
| Editorial cleanliness | Fail | Tool-process text leaked into the first sentence; the article also contains a typo and raw placeholder-style metadata. |
| Claim grounding | Fail | Several player-specific tactical claims were generated from aggregate-only input. |
| Publication gate | Fail | The application accepted and displayed the response without structural or factual validation. |

**Total: 5 pass, 1 partial, 4 fail.**

## Runtime evidence

| Metric | Observed |
|---|---|
| Model | MiniMax-M3 through the configured Anthropic-compatible path |
| Model turns | 3 |
| Tool calls | 3 Firecrawl web searches |
| Provider-reported token sum | 13,816 tokens |
| Approximate end-to-end generation time | About 50 seconds |
| Final article length | About 250 Vietnamese words |
| Model input detail | Score, participants, tournament string, status, and aggregate `2 sets / 4 breaks / 5 deuce games`; no game-by-game PBP |
| Retrieval outcome | No second source reached the model |

Raw request metadata was deliberately excluded from this artifact because the browser network inspector exposed credential-bearing headers. No HAR or credential value was saved here.

## Claim validation

| Generated claim | Verdict | Basis |
|---|---|---|
| Mensik won 6-4, 7-5 | Verified | Stored match data and official tournament recap agree. |
| The match was on hard court in Montreal | Verified, weakly grounded | Present in the tournament label/UI, but normalized `surface` in the prompt context was blank. |
| Mensik advanced | Verified externally | Official recap places him in the quarterfinal lineup. |
| The event is Masters 1000 | Factually correct, not grounded in supplied structured context | The app classified the event as `ATP 250`, while the article asserted Masters 1000 without a successful source lookup. |
| Five games reached deuce | Consistent with stored PBP | Five games contain a 40-40 point score. |
| Four “break-point” | Incorrect terminology | The aggregation counts four break markers/successful breaks, not break-point opportunities. |
| Mensik controlled return games better | Unsupported | No player-specific return statistic or detailed PBP was sent to the model. |
| Van de Zandschulp created more deuce situations and improved at saving service games | Unsupported | Only the match-level deuce total was sent; no player attribution or save statistic was provided. |
| Mensik secured “one more break” at the decisive moment | Unsupported | The model received no game sequence, and stored PBP winner fields are internally inconsistent. |

## Findings

### P0 - The evidence contract is internally contradictory

The system prompt tells the model it has point-by-point evidence, but the user message contains only aggregate counts. This encourages detailed narrative without detailed evidence. The report prompt should either receive a normalized game timeline or explicitly forbid player-, game-, and momentum-level claims.

### P0 - Intermediate assistant text leaks into the final article

The Anthropic loop appends every text block across tool turns to `allText`. A first-turn sentence announcing another search was therefore prepended to the article. Only the final answer turn should become publication content, or intermediate text must be stored separately as trace data.

### P0 - There is no output acceptance gate

The app accepts any response longer than the current minimum even when it contains process narration, unsupported claims, missing-source disclaimers, malformed metadata, or obvious typos. A deterministic validator should reject or regenerate such output before it reaches the report viewer.

### P1 - Firecrawl response handling likely drops current response shapes

The search path received three large HTTP 200 responses but produced zero parsed results. `runFirecrawlSearch` treats `data` as an array; another repository module already normalizes multiple Firecrawl shapes. Search parsing should be unified and covered by fixtures before increasing prompt complexity.

### P1 - Point-by-point integrity is not trustworthy enough for prose

Four stored games have `gameWinner` values that disagree with the cumulative game score. Until mapper invariants are enforced, even a richer prompt can turn bad data into confident narrative.

### P1 - Data normalization is inconsistent

The UI identifies a hard-court Montreal match, normalized `surface` is blank, and the app category labels Montreal as `ATP 250`. These contradictions should be resolved upstream instead of asking the model to infer tournament facts from a display string.

### P2 - Cost and latency are disproportionate to output value

The provider reported 13,816 tokens across three turns for a short article, with all three retrieval calls yielding no usable evidence. The architecture needs a retrieval budget, early-stop rules, and a compact evidence packet.

## Recommended architecture changes

1. Introduce a versioned `MatchEvidence` object containing normalized facts, source provenance, a validated game timeline, and explicit unknowns.
2. Separate the workflow into `retrieve -> validate evidence -> draft -> validate output`; do not let a single conversational loop both research and publish.
3. Pass either detailed PBP or no PBP. Never describe aggregate break counts as break-point opportunities.
4. Preserve intermediate model/tool text only in observability logs; publish only the final structured field.
5. Require structured output with claims or source IDs, then run deterministic checks for score, winner, round, rankings, unsupported numbers, process narration, and required Vietnamese style.
6. Normalize Firecrawl response variants and add fixtures for successful, empty, and malformed responses.
7. Add PBP invariants: cumulative score must agree with game winner, set winner, and final score before narrative generation.
8. Use a cheap fact extraction/validation pass before any expensive narrative model call; fail closed when evidence is insufficient.

## Screenshots

- [Dashboard before generation](./01-dashboard.png)
- [Generation started](./02-generation-started.png)
- [Generation progress](./03-generation-progress.png)
- [Rendered generated report](./04-generated-report.png)

## Unresolved questions

- Does the deployed Vercel proxy apply different timeouts, logging, or credential handling from the tested Vite development proxies?
- Which Firecrawl schema is returned in deployment, and is it stable across search modes?
- Should a report be blocked when independent verification fails, or published with a clearly defined single-source label?
- Is the point-by-point inconsistency introduced by the upstream payload or by `flashscore-mapper.ts`?

