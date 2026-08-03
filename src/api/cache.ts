/**
 * TTL cache backed by localStorage.
 *
 * Used to reduce RapidAPI call volume (90 req/min cap, 1,000 req/day hard):
 * - Tournament info rarely changes within a day → cache 24h
 * - Fixtures change as matches go live → cache 2 min
 * - Test-connection results are valid for 30s
 *
 * Cache data is shared across API keys (the data is the same regardless of
 * which RapidAPI subscription fetches it). On a key change we still expose
 * a clear() for hygiene.
 *
 * Failures (quota exceeded, JSON parse errors) are swallowed silently — the
 * caller falls back to a network fetch.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number; // ms epoch
}

const NAMESPACE = "trh:apiCache:";

export class ApiCache {
  /**
   * Read a value. Returns null on miss or expiry (expired entries are deleted).
   */
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(NAMESPACE + key);
      if (!raw) return null;
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (typeof entry.expiresAt !== "number" || Date.now() > entry.expiresAt) {
        localStorage.removeItem(NAMESPACE + key);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  /**
   * Write a value with a TTL (milliseconds). Silently no-ops on quota errors.
   */
  set<T>(key: string, data: T, ttlMs: number): void {
    try {
      const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
      localStorage.setItem(NAMESPACE + key, JSON.stringify(entry));
    } catch {
      // quota / serialization — ignore
    }
  }

  /** Delete one key. */
  delete(key: string): void {
    try {
      localStorage.removeItem(NAMESPACE + key);
    } catch {
      /* ignore */
    }
  }

  /** Clear every key in this cache namespace. */
  clear(): void {
    try {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(NAMESPACE)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }

  /** How many entries are stored (including expired ones until next read). */
  size(): number {
    try {
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(NAMESPACE)) n++;
      }
      return n;
    } catch {
      return 0;
    }
  }
}

export const apiCache = new ApiCache();
