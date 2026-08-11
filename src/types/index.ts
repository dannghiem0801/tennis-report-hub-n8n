export type Sport = "tennis" | "football" | "basketball";

export type MatchStatus = "scheduled" | "live" | "completed";

/**
 * Tennis tournament tier. Mirrors the categories that flashscore4
 * returns in the `category` / `name` field of the list-by-date
 * response. Doubles events are filtered upstream; this is singles only.
 */
export type TennisTournamentCategory =
  | "ATP Masters 1000"
  | "ATP 500"
  | "ATP 250"
  | "WTA 1000"
  | "WTA 500"
  | "WTA 250"
  | "Grand Slam"
  | "Challenger"
  | "ITF";

/**
 * Football tournament tier. Coarse groupings — flashscore4 returns
 * league names like "Premier League" or "Champions League" in the
 * tournament `name`; we map them into these categories for sorting
 * and badge rendering. The mapping is in `flashscore-mapper.ts`.
 */
export type FootballTournamentCategory =
  | "World Cup"
  | "Continental Championship"
  | "Champions League"
  | "Europa League"
  | "Conference League"
  | "Top Domestic League"
  | "Other Domestic League"
  | "Domestic Cup"
  | "V-League"
  | "Friendly";

/** Sport-aware tournament category. Tennis vs football differ. */
export type TournamentCategory = TennisTournamentCategory | FootballTournamentCategory;

/**
 * A participant in a Match. Discriminated union by `kind`.
 *   - "player" (tennis): name, fullName, country, flag, ranking?, seed?
 *   - "team"   (football): name, shortName, country, flag, logoUrl?
 */
export type Participant =
  | {
      kind: "player";
      name: string;
      fullName: string;
      country: string;
      countryFlag: string;
      ranking?: number;
      seed?: number;
    }
  | {
      kind: "team";
      name: string;
      shortName: string;
      country: string;
      countryFlag: string;
      logoUrl?: string;
    };

/** Generic score: side1 vs side2. Tennis = sets, football = goals. */
export interface ScoreLine {
  side1: number;
  side2: number;
}

export interface SetScore {
  player1: number;
  player2: number;
  tiebreak?: { player1: number; player2: number };
}

/** Tennis stats (sourced from /matches/details endpoint). */
export interface TennisMatchStats {
  aces: { player1: number; player2: number };
  doubleFaults: { player1: number; player2: number };
  firstServePct: { player1: number; player2: number };
  breakPointsConverted: { player1: number; player2: number };
  breakPointsFaced: { player1: number; player2: number };
  totalPointsWon: { player1: number; player2: number };
  matchDurationMinutes: number;
}

/** Football stats (sourced from /matches/details). */
export interface FootballMatchStats {
  possession?: { home: number; away: number };
  shots?: { home: number; away: number };
  shotsOnTarget?: { home: number; away: number };
  fouls?: { home: number; away: number };
  corners?: { home: number; away: number };
  yellowCards?: { home: number; away: number };
  redCards?: { home: number; away: number };
  offsides?: { home: number; away: number };
}

export interface GoalEvent {
  side: "home" | "away";
  minute: number;
  stoppage?: number;
  scorer: string;
  assist?: string;
  isPenalty?: boolean;
  isOwnGoal?: boolean;
}

export interface CardEvent {
  side: "home" | "away";
  minute: number;
  stoppage?: number;
  player: string;
  color: "yellow" | "red" | "second-yellow";
}

export interface SubEvent {
  side: "home" | "away";
  minute: number;
  playerOut: string;
  playerIn: string;
}

export interface FootballEvents {
  goals: GoalEvent[];
  cards: CardEvent[];
  subs: SubEvent[];
}

/**
 * Sub-state of a completed match. Determines whether a Report is
 * generated. See glossary in CONTEXT.md for full list.
 */
export type MatchOutcome =
  | "normal"
  | "aet"
  | "pen"
  | "retired"
  | "walkover"
  | "cancelled"
  | "abandoned";

/** Common core for all Match variants. */
interface CommonMatchFields {
  id: string;
  sport: Sport;
  tournamentId: string;
  tournamentName: string;
  tournamentCategory: TennisTournamentCategory | FootballTournamentCategory;
  round: string;
  startTime: string;
  status: MatchStatus;
  outcome?: MatchOutcome;
  finalScore?: ScoreLine;
}

export interface TennisMatch extends CommonMatchFields {
  sport: "tennis";
  player1: Extract<Participant, { kind: "player" }>;
  player2: Extract<Participant, { kind: "player" }>;
  sets?: SetScore[];
  setsWon?: ScoreLine;
  currentSetScore?: { player1: number | string; player2: number | string };
  pointByPoint?: PointByPointData;
  stats?: TennisMatchStats;
  court?: string;
  surface?: "hard" | "clay" | "grass";
}

export interface FootballMatch extends CommonMatchFields {
  sport: "football";
  home: Extract<Participant, { kind: "team" }>;
  away: Extract<Participant, { kind: "team" }>;
  halftimeScore?: ScoreLine;
  events?: FootballEvents;
  stats?: FootballMatchStats;
  venue?: string;
  referee?: string;
}

/** Discriminated union of all Match variants. */
export type Match = TennisMatch | FootballMatch;

export interface PointByPointGame {
  homeGames: number;
  awayGames: number;
  gameWinner: 1 | 2;
  isBreak: 1 | 2 | null;
  server: 1 | 2;
  pointSequence: string;
}

export interface PointByPointSet {
  setNumber: number;
  name: string;
  games: PointByPointGame[];
}

export interface PointByPointData {
  sets: PointByPointSet[];
}

export interface Tournament {
  id: string;
  name: string;
  category: TennisTournamentCategory | FootballTournamentCategory;
  location: string;
  surface?: "hard" | "clay" | "grass";
  prizeMoney?: string;
  date: string;
  sport: Sport;
}

export type WatchlistStatus =
  | "pending"
  | "fetching-pbp"
  | "building-context"
  | "web-searching"
  | "consolidating"
  | "completed"
  | "failed";

/** Generic display row. side1/side2 = player or team depending on sport. */
export interface WatchlistEntry {
  id: string;
  sport: Sport;
  matchApiId: string;
  side1Name: string;
  side2Name: string;
  side1Flag: string;
  side2Flag: string;
  tournamentName: string;
  tournamentCategory: TennisTournamentCategory | FootballTournamentCategory;
  matchDate: string;
  startTime: string;
  status: WatchlistStatus;
  createdAt: string;
  finalScore?: string;
  winner?: string;
  batchId?: string;
  errorMessage?: string;
  pipelineStartedAt?: string;
}

export interface Report {
  id: string;
  watchlistId: string;
  matchApiId: string;
  sport: Sport;
  title: string;
  content: string;
  match: Match;
  generatedAt: string;
  editedAt?: string;
  isNew?: boolean;
  templateId?: string;
  isPrompt?: boolean;
  llmError?: string;
  llmModel?: string;
  triggeredBy?: "auto-on-completion" | "scheduled-batch";
  /**
   * Quality metadata produced by the publication-safe pipeline.
   * Optional so existing localStorage reports (without the new
   * validator) keep working — legacy reports continue to render and
   * remain copyable exactly as before.
   */
  quality?: ReportQuality;
}

export type ReportStatus = "ready" | "needs-review" | "reviewed";

export interface ReportQuality {
  status: ReportStatus;
  /** When the validator last ran on this report. */
  validatedAt: string;
  /** Codes of every issue surfaced, with messages. */
  issues: { code: string; message: string; blocking: boolean }[];
  /** How many repair attempts the validator ran (0 or 1). */
  repairAttempted: boolean;
  /** Did the post-repair envelope pass validation? */
  repairSucceeded?: boolean;
  /** API-only or API+web evidence was used. */
  sourceMode: "api-only" | "api-plus-web";
  /** Stable evidence IDs cited by the model in the final article. */
  evidenceIdsUsed: string[];
  /** Concise source summaries, surfaced in the report viewer. */
  sources: Array<{
    evidenceId: string;
    url: string;
    title: string;
    verified: boolean;
  }>;
  /** Validator + prompt bundle version that produced this report. */
  validatorVersion: string;
  /** Optional latency / token observability for the safety pipeline. */
  observability?: {
    turns: number;
    durationMs: number;
    repairTurns: number;
    repairDurationMs: number;
    totalTokens?: number;
  };
  /** When the user (or a manual edit) acknowledged the report. */
  acknowledgedAt?: string;
}

export type ScheduledBatchStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "cancelled";

export interface ScheduledBatch {
  id: string;
  name: string;
  fireAt: string;
  sport: Sport;
  watchlistEntryIds: string[];
  status: ScheduledBatchStatus;
  createdAt: string;
  completedAt?: string;
  summary?: BatchSummary;
}

export type BatchEntryOutcome =
  | "written"
  | "already-written"
  | "skipped-not-ended"
  | "skipped-cancelled"
  | "failed";

export interface BatchEntryResult {
  watchlistId: string;
  outcome: BatchEntryOutcome;
  reportId?: string;
  errorMessage?: string;
}

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
  sport: Sport;
  name: string;
  description: string;
  content: string;
  isDefault: boolean;
  kind?: "literal" | "prompt";
  bundledVersion?: string;
}

export interface Settings {
  pollingIntervalMinutes: number;
  defaultTemplateId: string;
  timezone: string;
  notificationsEnabled: boolean;
  llm?: LLMConfig;
  /** @deprecated No longer used. */
  useSampleDataOverride?: boolean;
}

export type LLMProvider = "anthropic" | "openai-compatible";

export type SearchProvider = "firecrawl" | "duckduckgo" | "serpapi" | "brave";

export interface LLMConfig {
  enabled: boolean;
  provider: LLMProvider;
  baseUrl?: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  enableThinking?: boolean;
  enableWebSearch?: boolean;
  searchProvider?: SearchProvider;
  searchApiKey?: string;
}
