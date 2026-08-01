/**
 * Feature flags — flip these to enable/disable features without removing code.
 *
 * Each flag is a `const boolean` (not a runtime value) so bundlers can
 * dead-code-eliminate the disabled branch in production. The cost of
 * an unused feature is just bundle bytes for its imports, not logic.
 *
 * Use cases:
 * - Hide a feature from end users while keeping the code as an escape
 *   hatch (e.g., a power-user tool that 95% of users don't need).
 * - Staged rollout: ship behind a flag, enable for a subset, then flip
 *   to `true` for everyone.
 *
 * Keep this file small. One flag per entry, with a 1-2 line comment
 * explaining what it gates and why the default is what it is.
 */

/**
 * Scheduled batch feature (ADR 0001 — safety-net deadline force-writes
 * for completed matches). The runner, store actions, and types stay in
 * the codebase; only the UI surface is hidden by default. Set to `true`
 * to re-enable the user-facing controls (match-row 🕐 button, watchlist
 * "Scheduled" tab, schedule modal, corner progress widget).
 *
 * Why default `false`: auto-on-completion + 10-min poll already covers
 * ~95% of the report-generation cases. The scheduled batch is insurance
 * for the remaining 5% (LLM timeouts, polling misses). The user
 * accepted the primary path is enough; the feature remains available
 * in code for power users / future re-enablement.
 */
export const SCHEDULE_FEATURE_ENABLED = false;
