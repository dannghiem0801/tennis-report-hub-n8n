/**
 * Persistence layer (Supabase abstraction over localStorage)
 * In production this would call Supabase client. For demo, we use localStorage
 * so the app persists across reloads without any backend.
 *
 * **Env layering**: `getSettings()` overlays values from `import.meta.env`
 * (via the typed `env` helper) on top of the localStorage value. This means
 * any `VITE_RAPID_API_KEY` / `VITE_LLM_*` set in `.env.local` will pre-fill
 * Settings on first boot. Env wins on every read — if you want Settings UI
 * edits to stick across reloads, leave the corresponding `VITE_*` blank.
 */

import type {
  Report,
  ReportTemplate,
  ScheduledBatch,
  Settings,
  WatchlistEntry,
} from "@/types";
import { env } from "@/lib/env";

const KEYS = {
  watchlist: "trh:watchlist",
  reports: "trh:reports",
  templates: "trh:templates",
  settings: "trh:settings",
  seenReports: "trh:seenReports",
  scheduledBatches: "trh:scheduledBatches",
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

export const storage = {
  // Watchlist
  getWatchlist(): WatchlistEntry[] {
    return read<WatchlistEntry[]>(KEYS.watchlist, []);
  },
  setWatchlist(items: WatchlistEntry[]): void {
    write(KEYS.watchlist, items);
  },

  // Reports
  getReports(): Report[] {
    return read<Report[]>(KEYS.reports, []);
  },
  setReports(items: Report[]): void {
    write(KEYS.reports, items);
  },

  // Templates
  getTemplates(): ReportTemplate[] {
    return read<ReportTemplate[]>(KEYS.templates, []);
  },
  setTemplates(items: ReportTemplate[]): void {
    write(KEYS.templates, items);
  },

  // Settings
  getSettings(): Settings {
    // Defaults baked into the code. Env-overlay happens BELOW — env wins
    // when set, otherwise the localStorage value is used. Non-key fields
    // (polling interval, timezone, etc.) are NOT env-overridable today;
    // they're user preferences, not secrets, so they stay in localStorage.
    const baseDefaults: Settings = {
      rapidApiKey: "",
      // Default = 0 (No Poll). Rationale: even with the current 1,000 req/day
      // cap, auto-polling is rarely needed — the 30-min cache already keeps
      // the dashboard fresh on every tab switch, and a heavy user burns
      // <100 req/day for normal report generation. Lean default keeps the
      // network quiet for users who only open the app a few times a day.
      // Users who want auto-poll can pick 5/10/15/30 in Settings.
      pollingIntervalMinutes: 0,
      defaultTemplateId: "tpl-default",
      timezone: "Asia/Ho_Chi_Minh",
      notificationsEnabled: true,
    };
    const stored = read<Partial<Settings>>(KEYS.settings, {});
    // Merge: defaults < stored < env. LLM is left to `migrateLLMConfig`
    // (called by the app store) so the env-wins logic for nested LLM
    // fields stays in one place. We only need to overlay the top-level
    // RapidAPI key here.
    const envRapidKey = env.rapidApiKey();
    return {
      ...baseDefaults,
      ...stored,
      // Env wins. Only overlay if env actually has a value (parseBool /
      // trimOrUndefined return undefined for blank, so a blank `VITE_*`
      // doesn't clobber a key the user saved via Settings).
      ...(envRapidKey ? { rapidApiKey: envRapidKey } : {}),
    };
  },
  setSettings(settings: Settings): void {
    write(KEYS.settings, settings);
  },

  // Seen reports (for "Mới" badge)
  getSeenReportIds(): string[] {
    return read<string[]>(KEYS.seenReports, []);
  },
  setSeenReportIds(ids: string[]): void {
    write(KEYS.seenReports, ids);
  },

  // Scheduled batches (see ADR 0001 — safety-net deadline force-writes)
  getScheduledBatches(): ScheduledBatch[] {
    return read<ScheduledBatch[]>(KEYS.scheduledBatches, []);
  },
  setScheduledBatches(batches: ScheduledBatch[]): void {
    write(KEYS.scheduledBatches, batches);
  },
};
