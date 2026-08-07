export type Sport = "tennis" | "football" | "basketball";

export type MatchStatus = "scheduled" | "live" | "completed";

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

export type TournamentCategory = TennisTournamentCategory | FootballTournamentCategory;

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

export interface ScoreLine {
  side1: number;
  side2: number;
}

export interface SetScore {
  player1: number;
  player2: number;
  tiebreak?: { player1: number; player2: number };
}

export interface TennisMatchStats {
  aces: { player1: number; player2: number };
  doubleFaults: { player1: number; player2: number };
  firstServePct: { player1: number; player2: number };
  breakPointsConverted: { player1: number; player2: number };
  breakPointsFaced: { player1: number; player2: number };
  totalPointsWon: { player1: number; player2: number };
  matchDurationMinutes: number;
}

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

export type MatchOutcome =
  | "normal"
  | "aet"
  | "pen"
  | "retired"
  | "walkover"
  | "cancelled"
  | "abandoned";

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
  rapidApiKey: string;
  pollingIntervalMinutes: number;
  defaultTemplateId: string;
  timezone: string;
  notificationsEnabled: boolean;
  llm?: LLMConfig;
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
