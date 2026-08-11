/**
 * Persistence layer (Supabase abstraction over localStorage)
 * Multi-sport refactor (ADR 0002): per-sport data lives under
 * per-sport keys (e.g. `trh:tennis:watchlist`, `trh:football:watchlist`).
 * The single-sport `trh:activeSport` key stores the user's current
 * TopBar selection. Per-sport keys mean the data is naturally isolated;
 * the app filters by `sport` field on each entity and reads the
 * per-sport key.
 *
 * Migration: legacy entries under the old single-sport keys
 * (`trh:watchlist`, `trh:reports`, etc.) are migrated on first load —
 * legacy watchlist entries are read once, tagged with `sport: "tennis"`,
 * and rewritten under the per-sport key. Same for reports and
 * scheduledBatches. Templates are also split per-sport. Settings is
 * shared (not per-sport).
 */

import type {
  Report,
  ReportTemplate,
  ScheduledBatch,
  Settings,
  Sport,
  WatchlistEntry,
} from "@/types";

const KEYS = {
  watchlist: (sport: Sport) => `trh:${sport}:watchlist`,
  reports: (sport: Sport) => `trh:${sport}:reports`,
  templates: (sport: Sport) => `trh:${sport}:templates`,
  scheduledBatches: (sport: Sport) => `trh:${sport}:scheduledBatches`,
  settings: "trh:settings",
  seenReports: (sport: Sport) => `trh:${sport}:seenReports`,
  activeSport: "trh:activeSport",
} as const;

const LEGACY_KEYS = {
  watchlist: "trh:watchlist",
  reports: "trh:reports",
  templates: "trh:templates",
  scheduledBatches: "trh:scheduledBatches",
  seenReports: "trh:seenReports",
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / serialisation errors
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateWatchlistEntry(entry: any): WatchlistEntry {
  const sport: Sport = (entry.sport as Sport | undefined) ?? "tennis";
  if (entry.side1Name !== undefined) return { ...entry, sport };
  return {
    ...entry,
    sport,
    side1Name: entry.player1Name ?? "",
    side2Name: entry.player2Name ?? "",
    side1Flag: entry.player1Flag ?? "",
    side2Flag: entry.player2Flag ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateReportEntry(report: any): Report {
  const sport: Sport = (report.sport as Sport | undefined) ?? "tennis";
  return { ...report, sport };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateScheduledBatch(batch: any): ScheduledBatch {
  const sport: Sport = (batch.sport as Sport | undefined) ?? "tennis";
  return { ...batch, sport };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateTemplate(tpl: any): ReportTemplate {
  const sport: Sport = (tpl.sport as Sport | undefined) ?? "tennis";
  return { ...tpl, sport };
}

function migrateLegacyIfNeeded(): void {
  const legacyWatchlist = read<WatchlistEntry[] | null>(LEGACY_KEYS.watchlist, null);
  if (legacyWatchlist && Array.isArray(legacyWatchlist) && legacyWatchlist.length > 0) {
    const migrated = legacyWatchlist.map(migrateWatchlistEntry);
    const tennisEntries = migrated.filter((e) => (e.sport ?? "tennis") === "tennis");
    if (tennisEntries.length > 0) {
      const existing = read<WatchlistEntry[]>(KEYS.watchlist("tennis"), []);
      if (existing.length === 0) write(KEYS.watchlist("tennis"), tennisEntries);
    }
    remove(LEGACY_KEYS.watchlist);
  }
  const legacyReports = read<Report[] | null>(LEGACY_KEYS.reports, null);
  if (legacyReports && Array.isArray(legacyReports) && legacyReports.length > 0) {
    const migrated = legacyReports.map(migrateReportEntry);
    const tennisEntries = migrated.filter((r) => (r.sport ?? "tennis") === "tennis");
    if (tennisEntries.length > 0) {
      const existing = read<Report[]>(KEYS.reports("tennis"), []);
      if (existing.length === 0) write(KEYS.reports("tennis"), tennisEntries);
    }
    remove(LEGACY_KEYS.reports);
  }
  const legacyTemplates = read<ReportTemplate[] | null>(LEGACY_KEYS.templates, null);
  if (legacyTemplates && Array.isArray(legacyTemplates) && legacyTemplates.length > 0) {
    const migrated = legacyTemplates.map(migrateTemplate);
    const tennisTemplates = migrated.filter((t) => (t.sport ?? "tennis") === "tennis");
    if (tennisTemplates.length > 0) {
      const existing = read<ReportTemplate[]>(KEYS.templates("tennis"), []);
      if (existing.length === 0) write(KEYS.templates("tennis"), tennisTemplates);
    }
    remove(LEGACY_KEYS.templates);
  }
  const legacyBatches = read<ScheduledBatch[] | null>(LEGACY_KEYS.scheduledBatches, null);
  if (legacyBatches && Array.isArray(legacyBatches) && legacyBatches.length > 0) {
    const migrated = legacyBatches.map(migrateScheduledBatch);
    const tennisBatches = migrated.filter((b) => (b.sport ?? "tennis") === "tennis");
    if (tennisBatches.length > 0) {
      const existing = read<ScheduledBatch[]>(KEYS.scheduledBatches("tennis"), []);
      if (existing.length === 0) write(KEYS.scheduledBatches("tennis"), tennisBatches);
    }
    remove(LEGACY_KEYS.scheduledBatches);
  }
  const legacySeen = read<string[] | null>(LEGACY_KEYS.seenReports, null);
  if (legacySeen && Array.isArray(legacySeen) && legacySeen.length > 0) {
    const existing = read<string[]>(KEYS.seenReports("tennis"), []);
    if (existing.length === 0) write(KEYS.seenReports("tennis"), legacySeen);
    remove(LEGACY_KEYS.seenReports);
  }
}

let migrationDone = false;
function ensureMigration(): void {
  if (migrationDone) return;
  migrationDone = true;
  try {
    migrateLegacyIfNeeded();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[persistence] legacy migration failed (continuing):", err);
  }
}

export const storage = {
  getWatchlist(sport: Sport): WatchlistEntry[] {
    ensureMigration();
    return read<WatchlistEntry[]>(KEYS.watchlist(sport), []).map(migrateWatchlistEntry);
  },
  setWatchlist(sport: Sport, items: WatchlistEntry[]): void {
    write(KEYS.watchlist(sport), items);
  },
  getReports(sport: Sport): Report[] {
    ensureMigration();
    return read<Report[]>(KEYS.reports(sport), []).map(migrateReportEntry);
  },
  setReports(sport: Sport, items: Report[]): void {
    write(KEYS.reports(sport), items);
  },
  getTemplates(sport: Sport): ReportTemplate[] {
    ensureMigration();
    return read<ReportTemplate[]>(KEYS.templates(sport), []).map(migrateTemplate);
  },
  setTemplates(sport: Sport, items: ReportTemplate[]): void {
    write(KEYS.templates(sport), items);
  },
  getSettings(): Settings {
    const baseDefaults: Settings = {
      pollingIntervalMinutes: 0,
      defaultTemplateId: "tpl-default",
      timezone: "Asia/Ho_Chi_Minh",
      notificationsEnabled: true,
    };
    const stored = read<Partial<Settings>>(KEYS.settings, {});
    return {
      ...baseDefaults,
      ...stored,
    };
  },
  setSettings(settings: Settings): void {
    write(KEYS.settings, settings);
  },
  getSeenReportIds(sport: Sport): string[] {
    ensureMigration();
    return read<string[]>(KEYS.seenReports(sport), []);
  },
  setSeenReportIds(sport: Sport, ids: string[]): void {
    write(KEYS.seenReports(sport), ids);
  },
  getScheduledBatches(sport: Sport): ScheduledBatch[] {
    ensureMigration();
    return read<ScheduledBatch[]>(KEYS.scheduledBatches(sport), []).map(migrateScheduledBatch);
  },
  setScheduledBatches(sport: Sport, batches: ScheduledBatch[]): void {
    write(KEYS.scheduledBatches(sport), batches);
  },
  getActiveSport(): Sport {
    const stored = read<Sport | null>(KEYS.activeSport, null);
    if (stored === "tennis" || stored === "football" || stored === "basketball") {
      return stored;
    }
    return "tennis";
  },
  setActiveSport(sport: Sport): void {
    write(KEYS.activeSport, sport);
  },

  // Unified (sport-agnostic) accessors (ADR 0003). The per-sport
  // methods above remain the source of truth in localStorage; these
  // helpers aggregate them so the watchlist / reports / batches are
  // presented as a single sport-agnostic collection to the UI.
  // Writes split the input by `sport` and route each subset to the
  // corresponding per-sport key.
  getUnifiedWatchlist(): WatchlistEntry[] {
    return [
      ...storage.getWatchlist("tennis"),
      ...storage.getWatchlist("football"),
      ...storage.getWatchlist("basketball"),
    ];
  },
  setUnifiedWatchlist(items: WatchlistEntry[]): void {
    const by: Record<Sport, WatchlistEntry[]> = {
      tennis: [],
      football: [],
      basketball: [],
    };
    for (const entry of items) by[entry.sport].push(entry);
    storage.setWatchlist("tennis", by.tennis);
    storage.setWatchlist("football", by.football);
    storage.setWatchlist("basketball", by.basketball);
  },
  getUnifiedReports(): Report[] {
    return [
      ...storage.getReports("tennis"),
      ...storage.getReports("football"),
      ...storage.getReports("basketball"),
    ];
  },
  setUnifiedReports(items: Report[]): void {
    const by: Record<Sport, Report[]> = { tennis: [], football: [], basketball: [] };
    for (const r of items) by[r.sport].push(r);
    storage.setReports("tennis", by.tennis);
    storage.setReports("football", by.football);
    storage.setReports("basketball", by.basketball);
  },
  getUnifiedSeenReportIds(): string[] {
    return [
      ...storage.getSeenReportIds("tennis"),
      ...storage.getSeenReportIds("football"),
      ...storage.getSeenReportIds("basketball"),
    ];
  },
  setUnifiedSeenReportIds(ids: string[]): void {
    // seenIds are a flat set across all sports (they reference report
    // ids which are unique globally because the watchlist id is also
    // unique globally). So we can write the full set to each per-sport
    // key; the read on any sport returns the merged set.
    storage.setSeenReportIds("tennis", ids);
    storage.setSeenReportIds("football", ids);
    storage.setSeenReportIds("basketball", ids);
  },
  getUnifiedScheduledBatches(): ScheduledBatch[] {
    return [
      ...storage.getScheduledBatches("tennis"),
      ...storage.getScheduledBatches("football"),
      ...storage.getScheduledBatches("basketball"),
    ];
  },
  setUnifiedScheduledBatches(batches: ScheduledBatch[]): void {
    const by: Record<Sport, ScheduledBatch[]> = {
      tennis: [],
      football: [],
      basketball: [],
    };
    for (const b of batches) by[b.sport].push(b);
    storage.setScheduledBatches("tennis", by.tennis);
    storage.setScheduledBatches("football", by.football);
    storage.setScheduledBatches("basketball", by.basketball);
  },
};
