export type Sport = "tennis" | "football" | "basketball";

export type MatchStatus = "scheduled" | "live" | "completed";

export type TournamentCategory =
  | "ATP Masters 1000"
  | "ATP 500"
  | "ATP 250"
  | "WTA 1000"
  | "WTA 500"
  | "WTA 250"
  | "Grand Slam"
  | "Challenger"
  | "ITF";

export interface Player {
  name: string;
  fullName: string;
  country: string; // ISO 3166-1 alpha-2
  countryFlag: string; // emoji
  ranking?: number;
  seed?: number;
}

export interface SetScore {
  player1: number;
  player2: number;
  tiebreak?: { player1: number; player2: number };
}

export interface Match {
  id: string;
  tournamentId: string;
  tournamentName: string;
  tournamentCategory: TournamentCategory;
  round: string; // "R1", "QF", "SF", "F", etc.
  startTime: string; // ISO with +07
  status: MatchStatus;
  player1: Player;
  player2: Player;
  sets?: SetScore[];
  /** Number of sets won by each player. Populated from the list-by-date
   *  `scores: {home, away}` field (which only carries set counts, not per-
   *  set game scores). Always present for completed matches. */
  setsWon?: { player1: number; player2: number };
  /** In-play game point — can be numeric ("30-15" style) or string
   *  ("40", "A") from the live API. */
  currentSetScore?: { player1: number | string; player2: number | string };
  /** Point-by-point data for completed matches. Populated lazily when the
   *  match is added to the watchlist (no point fetching for matches the
   *  user never reports on). Sourced from
   *  /api/flashscore/v2/matches/match/point-by-point. */
  pointByPoint?: PointByPointData;
  stats?: MatchStats;
  court?: string;
  surface?: "hard" | "clay" | "grass";
}

export interface MatchStats {
  aces: { player1: number; player2: number };
  doubleFaults: { player1: number; player2: number };
  firstServePct: { player1: number; player2: number };
  breakPointsConverted: { player1: number; player2: number };
  breakPointsFaced: { player1: number; player2: number };
  totalPointsWon: { player1: number; player2: number };
  matchDurationMinutes: number;
}

/**
 * Point-by-point data from /matches/match/point-by-point. Each set has
 * an ordered array of games; each game has the running score, server,
 * break indicator, and a comma-separated point sequence using tennis
 * notation (15:0, 30:0, 40:0, A:40, etc.) with break-point markers
 * like "|B1|" (first break point of the game), "|B2|" (second), etc.
 */
export interface PointByPointGame {
  /** Running games won by player 1 in this set (cumulative). */
  homeGames: number;
  /** Running games won by player 2 in this set. */
  awayGames: number;
  /** 1 = player 1 won the game, 2 = player 2. */
  gameWinner: 1 | 2;
  /** 1 = player 1 broke player 2's serve, 2 = player 2 broke player 1's. null = no break. */
  isBreak: 1 | 2 | null;
  /** Who served the game (1 or 2). */
  server: 1 | 2;
  /** Comma-separated tennis point notation, e.g. "15:0, 30:0, 40:0 |B1|, 40:15". */
  pointSequence: string;
}

export interface PointByPointSet {
  /** 1-based set number. */
  setNumber: number;
  /** Human label from API, e.g. "Set 1". */
  name: string;
  /** Ordered games played in this set. */
  games: PointByPointGame[];
}

export interface PointByPointData {
  sets: PointByPointSet[];
}

export interface Tournament {
  id: string;
  name: string;
  category: TournamentCategory;
  location: string;
  surface: "hard" | "clay" | "grass";
  prizeMoney?: string;
  date: string; // YYYY-MM-DD
}

/**
 * Lifecycle of a WatchlistEntry (per-match report generation pipeline).
 *
 *   pending → fetching-pbp → building-context → (web-searching) → consolidating → completed
 *                              ↓ any step ↓
 *                                              failed
 *
 * Each state corresponds to a discrete pipeline step the user can observe
 * in the watchlist UI (icon + label + tooltip). `generating` (the old
 * single state) is split into 4 for transparency.
 */
export type WatchlistStatus =
  | "pending"           // Waiting for match to reach "completed" status
  | "fetching-pbp"     // Calling FlashScore /matches/match/point-by-point
  | "building-context" // Building structured data for LLM (PBP + sets + stats)
  | "web-searching"    // Running web_search for external context (optional)
  | "consolidating"    // LLM is generating the report
  | "completed"        // Report generated and saved
  | "failed";          // Any step failed; entry holds error message

export interface WatchlistEntry {
  id: string;
  matchApiId: string;
  player1Name: string;
  player2Name: string;
  player1Flag: string;
  player2Flag: string;
  tournamentName: string;
  tournamentCategory: TournamentCategory;
  matchDate: string; // YYYY-MM-DD
  startTime: string;
  status: WatchlistStatus;
  createdAt: string; // ISO timestamp
  finalScore?: string; // e.g. "6-4, 3-6, 6-3"
  winner?: string;
  /** Optional link to a ScheduledBatch this entry belongs to. Set when
   *  the entry is added to a batch via "Schedule batch"; cleared when
   *  removed from the batch, when the batch is cancelled, or after the
   *  batch fires (terminal state). UI uses this to show the ⏰ badge
   *  next to the entry in the watchlist. */
  batchId?: string;
  /** Set when status === "failed". UI surfaces this in a tooltip / banner. */
  errorMessage?: string;
  /** When the pipeline started (any non-pending state). For "time elapsed" UI. */
  pipelineStartedAt?: string;
}

export interface Report {
  id: string;
  watchlistId: string;
  matchApiId: string;
  title: string;
  content: string; // markdown (for "literal" templates) OR a ready-to-paste prompt (for "prompt" templates)
  match: Match; // snapshot
  generatedAt: string;
  editedAt?: string;
  isNew?: boolean; // for badge
  /** Which template generated this report. Used by the viewer to render
   *  "prompt mode" banners when the template is a few-shot LLM prompt. */
  templateId?: string;
  /** True when the content is a prompt to send to an LLM (not a final report). */
  isPrompt?: boolean;
  /** When the prompt template was auto-run through an LLM that failed,
   *  this carries the error message. The report falls back to the
   *  prompt+context content so the user can copy-paste manually. */
  llmError?: string;
  /** Which model produced the final report (when LLM call succeeded). */
  llmModel?: string;
  /** Which trigger produced this Report. Older reports without this
   *  field are treated as "auto-on-completion" for backward compat.
   *  "scheduled-batch" is the safety-net force-write from a
   *  ScheduledBatch fire. Use this to filter on the Reports page
   *  (e.g. highlight safety-net writes for editorial review). */
  triggeredBy?: "auto-on-completion" | "scheduled-batch";
}

/**
 * Lifecycle of a ScheduledBatch. Transitions:
 *   pending → running        (fireAt reached; runner claims the batch)
 *   running → completed      (all entries handled, zero failed)
 *   running → partial        (at least one entry failed after retries)
 *   pending → cancelled      (user cancelled before fireAt)
 *
 * Atomic claim via status guards against the dual-fire race between
 * setTimeout and polling. See ADR 0001.
 */
export type ScheduledBatchStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "cancelled";

/**
 * One ScheduledBatch = one user-set fireAt + a list of WatchlistEntry
 * ids. Edit/cancel is open while status is "pending". Once "running"
 * or any terminal status — read-only.
 *
 * Safety-net scope (ADR 0001): the scheduled trigger at fireAt
 * processes ONLY entries whose match is completed and have no Report
 * yet. Matches still scheduled or live at fireAt are skipped, NOT
 * snapshotted. They remain in the watchlist for auto-on-completion
 * to handle when they actually end.
 */
export interface ScheduledBatch {
  id: string;
  /** Auto-generated label like "Batch 18:00 — 5 trận". User can rename. */
  name: string;
  /** ISO timestamp (user's local TZ, e.g. Asia/Ho_Chi_Minh). */
  fireAt: string;
  /** WatchlistEntry ids included in this batch. */
  watchlistEntryIds: string[];
  status: ScheduledBatchStatus;
  createdAt: string;
  /** Set when batch transitions to a terminal status. */
  completedAt?: string;
  /** Populated when batch leaves "running". Absent for pending batches. */
  summary?: BatchSummary;
}

/**
 * Per-entry outcome from a batch run. Stored on the batch's summary,
 * NOT on the WatchlistEntry — the entry's own status already tracks
 * "completed"/"failed" via the existing report generator.
 */
export type BatchEntryOutcome =
  /** Report was force-written by this batch run. */
  | "written"
  /** Report already existed before the batch fired (auto-on-completion beat us). */
  | "already-written"
  /** Match was still scheduled or live at fireAt — skipped (no snapshot). */
  | "skipped-not-ended"
  /** Match was cancelled or walkover — skipped (no real play data). */
  | "skipped-cancelled"
  /** LLM call failed after the batch's inline retries (1–2x). */
  | "failed";

export interface BatchEntryResult {
  watchlistId: string;
  outcome: BatchEntryOutcome;
  /** Set when outcome is "written". */
  reportId?: string;
  /** Set when outcome is "failed". */
  errorMessage?: string;
}

/**
 * Aggregate view of a completed batch. Counts for the corner widget
 * + per-entry detail for the watchlist summary view. Counts are
 * derived from `results` but stored explicitly so the UI doesn't
 * have to re-reduce on every render.
 */
export interface BatchSummary {
  total: number;
  written: number;
  alreadyWritten: number;
  skippedNotEnded: number;
  skippedCancelled: number;
  failed: number;
  results: BatchEntryResult[];
}

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  isDefault: boolean;
  /**
   * - "literal" (default): `content` is a markdown string with placeholders like
   *   {tournament}, {player1}, etc. — filled in deterministically.
   * - "prompt": `content` is a few-shot prompt (e.g. persona + rules + glossary);
   *   structured match data is appended at the end. The report content is
   *   intended to be pasted into an LLM, which then produces the actual recap.
   */
  kind?: "literal" | "prompt";
  /**
   * Bumped whenever the bundled content for this template id changes.
   * Used to migrate stale localStorage copies on app start. User-created
   * templates (ids not in DEFAULT_TEMPLATES) should leave this undefined.
   */
  bundledVersion?: string;
}

export interface Settings {
  rapidApiKey: string;
  pollingIntervalMinutes: number;
  defaultTemplateId: string;
  timezone: string; // e.g. "Asia/Ho_Chi_Minh"
  notificationsEnabled: boolean;
  /**
   * OpenAI-compatible LLM config. When `enabled` and `apiKey` are set, the
   * app auto-calls the LLM on watchlist match completion using the default
   * "prompt" template; the LLM response becomes the final report content
   * (no more manual copy-paste). When unset/disabled, the prompt is saved
   * as-is for the user to paste into an LLM manually.
   */
  llm?: LLMConfig;
  /**
   * @deprecated No longer used. Was an opt-in to force sample data. Kept
   * on the interface so legacy localStorage entries don't break on parse;
   * the value is ignored.
   */
  useSampleDataOverride?: boolean;
}

/**
 * LLM provider identifier. Determines which API client and which
 * request shape the app uses when calling the LLM.
 *
 * - "anthropic"          → Anthropic Messages API (`/v1/messages`).
 *                          Verified against the Minimax Anthropic-
 *                          compatible spec (platform.minimax.io).
 *                          The Minimax proxy does NOT implement
 *                          Anthropic server-side tools like
 *                          `web_search_20250305`, so we never
 *                          declare a `tools` list. Instead, models
 *                          like MiniMax-M3 use `thinking` blocks for
 *                          internal reasoning.
 * - "openai-compatible"  → OpenAI Chat Completions shape
 *                          (`/chat/completions`). Works with OpenAI,
 *                          Azure, Groq, Together.ai, OpenRouter,
 *                          Ollama, LM Studio, custom proxies.
 */
export type LLMProvider = "anthropic" | "openai-compatible";

/**
 * Search backend used by the `web_search` custom tool.
 *   - "firecrawl"  — Firecrawl `/v2/search` (RECOMMENDED). Returns
 *     full markdown content from each result (not just snippets),
 *     purpose-built for LLM workflows. CORS-enabled (called from
 *     browser directly, no proxy). Free tier 500 credits
 *     (~250 searches). Needs API key. Base URL
 *     `https://api.firecrawl.dev`.
 *   - "duckduckgo" — free, no key, works in browser via Vite dev proxy
 *     in dev mode. Often rate-limited / CAPTCHA-blocked from non-
 *     browser IPs. Kept as a fallback.
 *   - "serpapi"    — SerpAPI.com. Free tier 100 searches/month.
 *     Returns JSON snippets (no full content). Needs API key.
 *   - "brave"      — Brave Search API. Free tier 2000 queries/month.
 *     Returns JSON snippets. Needs API key.
 */
export type SearchProvider = "firecrawl" | "duckduckgo" | "serpapi" | "brave";

/**
 * LLM configuration. Fields used depend on the chosen provider:
 * - `baseUrl` is REQUIRED for both providers. For Anthropic-compatible
 *   Minimax proxy, the spec base is `https://api.minimax.io/anthropic`.
 *   The app appends `/v1/messages` (Anthropic) or `/chat/completions`
 *   (OpenAI) to `baseUrl`.
 * - `enableThinking` is Anthropic-only — sends
 *   `thinking: {"type": "adaptive"}` so reasoning models can emit
 *   thinking blocks. Default ON. Without it, MiniMax-M3 leaks fake
 *   `<tool_call>` blocks into the text output.
 * - `enableWebSearch` is Anthropic-only — declares a custom
 *   `web_search` tool in the request so the model can call it to
 *   verify scores / look up context. Default ON. The tool is
 *   client-side executed; falls back to clear "not configured"
 *   message if no search backend is wired up. The model handles
 *   this gracefully (writes from provided data + cites "chưa
 *   cross-check được").
 * - `searchProvider` + `searchApiKey` — which backend the `web_search`
 *   tool uses when called. Default: "firecrawl" (recommended). Set
 *   to a different provider if you don't have a Firecrawl key.
 *   For Firecrawl, the API key looks like `fc-...`.
 */
export interface LLMConfig {
  /** Master switch. When false, the app falls back to prompt-only mode. */
  enabled: boolean;
  /** Provider. Defaults to "anthropic" for new configs. */
  provider: LLMProvider;
  /** Base URL. Required for both providers. */
  baseUrl?: string;
  /** Bearer token (openai-compatible) or x-api-key (Anthropic). */
  apiKey: string;
  /** Model identifier for the chosen provider. */
  model: string;
  /** Sampling temperature. Default 0.7. Range [0, 2] per Anthropic spec. */
  temperature?: number;
  /** Max output tokens. Default 200000. Anthropic requires this. */
  maxTokens?: number;
  /**
   * Anthropic only — enable `thinking: {"type": "adaptive"}` so the
   * model can emit reasoning blocks internally. Default true. Strongly
   * recommended for MiniMax-M3; harmless for M2.x where thinking is
   * always on anyway. Has no effect on OpenAI-compatible providers.
   */
  enableThinking?: boolean;
  /**
   * Anthropic only — declare a custom `web_search` tool in the request.
   * Default true. The model can call it to verify scores or look up
   * context. The tool is executed client-side; current implementation
   * returns a clear "not configured" message if no search backend is
   * wired up. The prompt instructs the model to write from provided
   * data when the tool returns no results. Has no effect on
   * OpenAI-compatible providers.
   */
  enableWebSearch?: boolean;
  /**
   * Which search backend the `web_search` tool uses. Default
   * "duckduckgo" (free, dev-only via Vite proxy). For reliable
   * verification, set to "serpapi" or "brave" + provide
   * `searchApiKey`.
   */
  searchProvider?: SearchProvider;
  /**
   * API key for the chosen search backend. Required for "serpapi"
   * and "brave". Ignored for "duckduckgo".
   */
  searchApiKey?: string;
}
