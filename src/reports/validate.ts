/**
 * Validate and (optionally) repair a draft returned by the LLM.
 *
 * Pipeline:
 *
 *   raw response text -> parse JSON envelope -> run blocking &
 *   non-blocking checks -> return a `ValidationResult` carrying the
 *   parsed envelope, issue codes, and a suggested markdown body
 *   suitable for storage.
 *
 * Blocking issues cause a repair attempt (exactly one) before the
 * caller falls back to "needs-review" or prompt-mode. Non-blocking
 * issues only set warnings so the UI can surface them.
 *
 * The validator is the publication gate. It must:
 *  - reject malformed envelopes (not JSON, missing fields, wrong types);
 *  - reject wrong / missing winner or final score;
 *  - reject invented match-stat numbers (numeric values that disagree
 *    with the evidence, EXCEPT dates, times, years, and numbers
 *    embedded in official tournament names);
 *  - reject invented evidence IDs in `evidenceIdsUsed`;
 *  - reject process / tool narration that leaked into the body;
 *  - reject false "verified by source" claims;
 *  - reject unsupported tactical narrative (per-game commentary when
 *    the evidence has no PBP, or specific minutes when football events
 *    are absent);
 *  - reject truncation (`finishReason === "max_tokens"` / `"length"`);
 *  - non-block on 200-400 word count misses, missing optional
 *    metadata, unavailable external source, or omitted invalid PBP /
 *    events.
 */

import type { FootballMatchEvidence, MatchEvidence, TennisMatchEvidence } from "./evidence";

export type IssueCode =
  | "envelope_invalid"
  | "envelope_missing_field"
  | "score_mismatch"
  | "winner_mismatch"
  | "stat_number_invented"
  | "unknown_evidence_id"
  | "process_text"
  | "false_source_claim"
  | "tactical_invention"
  | "truncation"
  | "word_count_short"
  | "word_count_long"
  | "optional_metadata_missing"
  | "external_source_unavailable";

export interface ValidationIssue {
  code: IssueCode;
  message: string;
  blocking: boolean;
}

export interface ReportEnvelopeDraft {
  articleMarkdown: string;
  sourceMode: "api-only" | "api-plus-web";
  evidenceIdsUsed: string[];
}

export interface ValidationResult {
  ok: boolean;
  envelope: ReportEnvelopeDraft | null;
  issues: ValidationIssue[];
  /** Convenience: count of blocking issues. */
  blockingCount: number;
}

/** Maximum allowed word count for the article body. 400 is the upper
 *  bound from the existing prompts (Vietnamese style); we accept
 *  slightly longer for completeness but flag it. */
const HARD_MAX_WORDS = 800;
const SOFT_MAX_WORDS = 400;
const SOFT_MIN_WORDS = 200;

/** Process / tool narration patterns. Each is a substring we never
 *  want to see in a publication-safe article. */
const PROCESS_PATTERNS: RegExp[] = [
  /I'll search/i,
  /Let me search/i,
  /let me scrape/i,
  /I'll scrape/i,
  /\bweb_search\b/,
  /\bscrape_url\b/,
  /tôi sẽ tìm/i,
  /để tôi tìm/i,
  /\[scrape_url:/i,
  /\[Firecrawl/i,
  /\[SerpAPI/i,
  /\[Brave Search/i,
  /\[DuckDuckGo/i,
  /\[Web search results/i,
  /hệ thống đã scrape sẵn/i,
  /theo dữ liệu được cung cấp/i,
  /cross-check/i,
  /verify/i,
  /trong lúc chờ/i,
  /tôi không thể/i,
];

/** Try hard to parse the model's response as a JSON envelope. We
 *  accept:
 *   - a JSON object with the required fields,
 *   - a fenced ```json ... ``` block (the model sometimes wraps it),
 *   - text that starts or ends with a JSON object. */
export function parseEnvelope(rawResponse: string): ReportEnvelopeDraft | null {
  const trimmed = rawResponse.trim();
  if (!trimmed) return null;
  // First try direct JSON.
  const direct = tryParseObject(trimmed);
  if (direct) return validateEnvelopeShape(direct);
  // Try fenced JSON.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fence) {
    const inner = tryParseObject(fence[1].trim());
    if (inner) return validateEnvelopeShape(inner);
  }
  // Try substring matching the first { ... last }.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    const obj = tryParseObject(trimmed.slice(first, last + 1));
    if (obj) return validateEnvelopeShape(obj);
  }
  return null;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function validateEnvelopeShape(obj: Record<string, unknown>): ReportEnvelopeDraft | null {
  const article = obj.articleMarkdown;
  const sourceMode = obj.sourceMode;
  const evidence = obj.evidenceIdsUsed;
  if (typeof article !== "string" || article.length < 20) return null;
  if (sourceMode !== "api-only" && sourceMode !== "api-plus-web") return null;
  if (!Array.isArray(evidence)) return null;
  const used: string[] = [];
  for (const id of evidence) {
    if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
    used.push(id);
  }
  return {
    articleMarkdown: article,
    sourceMode,
    evidenceIdsUsed: used,
  };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function wordMatchesInEvidence(value: string, evidence: MatchEvidence): boolean {
  // Numbers that appear inside official tournament names or as part
  // of dates/times are exempt from the stat-number check. Otherwise
  // we require the number to appear in the evidence (stringified).
  if (!/^\d{1,4}$/.test(value)) return true;
  const haystack = JSON.stringify(evidence);
  if (haystack.includes(value)) return true;
  // Exempt: 4-digit years (1900-2100). They belong to start time,
  // tournament names, or generic years — never to a stat count.
  const n = parseInt(value, 10);
  if (n >= 1900 && n <= 2100) return true;
  // Exempt: numbers embedded in the tournament name (e.g. "ATP 250",
  // "Masters 1000", "Matchday 25"). We tokenise the tournament name
  // and accept any number that appears as a standalone token.
  const tournamentName =
    evidence.sport === "tennis"
      ? evidence.facts.tournamentName
      : evidence.facts.tournamentName;
  // Also fold the tournament category into the exemption pool.
  const category =
    "tournamentCategory" in evidence.facts
      ? String((evidence.facts as { tournamentCategory?: string }).tournamentCategory ?? "")
      : "";
  const tournamentPool = `${tournamentName} ${category}`;
  const tournamentTokens = new Set(
    tournamentPool.split(/\s+/).map((t) => t.replace(/[^A-Za-z0-9]/g, ""))
  );
  if (tournamentTokens.has(value)) return true;
  // Exempt: round labels like "Matchday 25" or "Vòng 32" that
  // appear in `round` but were folded into the tournamentName.
  const round = evidence.facts.round;
  if (round && round.split(/\s+/).some((t) => t === value)) return true;
  // Exempt: time/duration fragments. When the article rephrases
  // duration in "X giờ Y phút" / "Y phút" form, the Y is the
  // remainder of minutes/60 — it doesn't appear in the evidence but
  // is a derived time fragment, not a stat count.
  if (Number.isFinite(n) && n < 200 && articleTimeExemptions.has(value)) return true;
  return false;
}

// Article-context registry for time rephrasings. `validateEnvelope`
// pushes a number into this set whenever it sees "NN giờ" / "NN phút"
// / "NN minutes" / "NN hours" in the article — those numbers never
// match a stat and would otherwise fail the invented-number check.
// Cleared at the start of every `validateEnvelope` call.
const articleTimeExemptions = new Set<string>();

/** Extract numeric mentions (1-4 digit numbers) from a body of text. */
function extractNumbers(text: string): string[] {
  const matches = text.match(/\b\d{1,4}\b/g) || [];
  // De-dupe while preserving order.
  return Array.from(new Set(matches));
}

/** Detect false "verified by source" claims. Any citation that
 *  references a web source must carry a matching evidence ID in
 *  `evidenceIdsUsed`, AND the source must be `verified: true`. If the
 *  model cites a source that's marked unverified, that's a false
 *  claim. */
function detectFalseSourceClaims(
  article: string,
  usedIds: string[],
  evidence: MatchEvidence
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // Match `[web-N]` citations.
  const citations = article.match(/\[web-(\d+)\]/g) || [];
  const sourcesById = new Map<string, { evidenceId: string; verified: boolean; url: string; title: string; excerpt: string }>();
  for (const s of evidence.sources) sourcesById.set(s.evidenceId, s);
  for (const c of citations) {
    const id = c.slice(1, -1);
    if (!usedIds.includes(id)) {
      issues.push({
        code: "unknown_evidence_id",
        message: `Citation ${id} không nằm trong evidenceIdsUsed`,
        blocking: true,
      });
      continue;
    }
    const source = sourcesById.get(id);
    if (source && !source.verified) {
      issues.push({
        code: "false_source_claim",
        message: `Citation ${id} tham chiếu nguồn chưa được hệ thống xác minh`,
        blocking: true,
      });
    }
  }
  return issues;
}

/** Check whether the article references per-game/per-minute facts that
 *  the evidence does not support. For tennis: per-game commentary is
 *  only valid when `tacticalTimeline` exists. For football: per-minute
 *  goal references are only valid when `matchEvents.goals` lists a
 *  goal with that minute. */
function detectTacticalInvention(
  article: string,
  evidence: MatchEvidence
): ValidationIssue[] {
  if (evidence.sport === "tennis") {
    const te = evidence as TennisMatchEvidence;
    if (!te.tacticalTimeline) {
      // Patterns that imply per-game knowledge.
      const perGamePatterns = [
        /game \d+/i,
        /break (ở|tại) game/i,
        /giữ game/i,
        /bẻ game (ở|tại)/i,
        /set point (ở|tại) game/i,
        /match point (ở|tại) game/i,
      ];
      for (const pat of perGamePatterns) {
        if (pat.test(article)) {
          return [{
            code: "tactical_invention",
            message: "Bài viết đề cập diễn biến từng game nhưng evidence không có tacticalTimeline",
            blocking: true,
          }];
        }
      }
    }
  } else {
    const fe = evidence as FootballMatchEvidence;
    const goalMinutes = new Set<number>();
    if (fe.matchEvents) {
      for (const g of fe.matchEvents.goals) goalMinutes.add(g.minute);
    }
    // Look for any "phút NN" claim.
    const minuteRefs = article.matchAll(/phút\s*(\d{1,3})(?:\+(\d{1,2}))?/gi);
    for (const m of minuteRefs) {
      const minute = parseInt(m[1], 10);
      if (Number.isFinite(minute) && goalMinutes.size > 0 && !goalMinutes.has(minute)) {
        // Allow mentions of the final score itself (e.g. "tỉ số 2-1" — that
        // doesn't trigger because "phút" is absent).
        return [{
          code: "tactical_invention",
          message: `Bài viết nhắc phút ${minute} không có trong matchEvents.goals`,
          blocking: true,
        }];
      }
    }
  }
  return [];
}

/** Detect process / tool narration that leaked into the article. */
function detectProcessText(article: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const pat of PROCESS_PATTERNS) {
    if (pat.test(article)) {
      issues.push({
        code: "process_text",
        message: `Bài viết chứa câu/đoạn process narration: /${pat.source}/`,
        blocking: true,
      });
      break;
    }
  }
  return issues;
}

/** Validate the envelope against the supplied evidence. */
export function validateEnvelope(
  envelope: ReportEnvelopeDraft,
  evidence: MatchEvidence,
  options?: { finishReason?: string; words?: number }
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const article = envelope.articleMarkdown;
  const wordCount = options?.words ?? countWords(article);

  // Reset time-fragment exemptions for this run. Numbers that
  // appear next to time words ("35 phút", "1 giờ") are derived
  // time fragments and never match a stat.
  articleTimeExemptions.clear();
  const timePattern = /(\d{1,3})\s*(giờ|phút|minutes?|hours?)/gi;
  for (const m of article.matchAll(timePattern)) {
    articleTimeExemptions.add(m[1]);
  }

  // Truncation.
  if (options?.finishReason === "max_tokens" || options?.finishReason === "length") {
    issues.push({
      code: "truncation",
      message: "Response bị truncate ở max_tokens — validator phải reject hoặc repair",
      blocking: true,
    });
  }

  // Process text (blocking).
  issues.push(...detectProcessText(article));

  // False source claims + unknown IDs (blocking).
  issues.push(...detectFalseSourceClaims(article, envelope.evidenceIdsUsed, evidence));

  // Tactical invention (blocking).
  issues.push(...detectTacticalInvention(article, evidence));

  // Final score must agree.
  if (evidence.sport === "tennis") {
    const te = evidence as TennisMatchEvidence;
    if (te.facts.finalScore) {
      // Accept the score in either perspective: player1-first
      // ("3-6, 6-7") or winner-first ("6-3, 7-6"). Vietnamese
      // journalism routinely writes the winner's number first.
      const variants: string[] = [];
      const sets = te.facts.finalScore;
      const forward = sets.map((s) => `${s.player1}-${s.player2}`).join(", ");
      const reverse = sets.map((s) => `${s.player2}-${s.player1}`).join(", ");
      variants.push(forward, reverse);
      // Also accept each set individually with separator variants.
      for (const sep of [",", " và ", " vs "]) {
        variants.push(sets.map((s) => `${s.player1}-${s.player2}`).join(sep));
        variants.push(sets.map((s) => `${s.player2}-${s.player1}`).join(sep));
      }
      if (!variants.some((v) => article.includes(v))) {
        issues.push({
          code: "score_mismatch",
          message: `Bài viết không chứa tỉ số set ${forward} hoặc ${reverse}`,
          blocking: true,
        });
      }
      if (te.facts.winnerSide !== null) {
        const winnerFirst = te.facts.winnerSide === 1 ? forward : reverse;
        const loserFirst = te.facts.winnerSide === 1 ? reverse : forward;
        if (article.includes(loserFirst) && loserFirst !== winnerFirst) {
          issues.push({
            code: "winner_mismatch",
            message: `Bài viết dùng tỉ số chung cuộc theo chiều người thua: ${loserFirst}; phải là ${winnerFirst}`,
            blocking: true,
          });
        }
      }
    }
    if (te.facts.winnerSide !== null) {
      const winnerName =
        te.facts.winnerSide === 1 ? te.facts.player1.fullName : te.facts.player2.fullName;
      const loserName =
        te.facts.winnerSide === 1 ? te.facts.player2.fullName : te.facts.player1.fullName;
      // Vietnamese journalism routinely drops trailing initials.
      // Accept either the full "Shelton B." form or the
      // last-name-only form "Shelton". For the LLM's natural output,
      // both names are usually mentioned via last name.
      const nameForms = (n: string): string[] => {
        const out = [n];
        // Strip trailing initial: "Shelton B." -> "Shelton"
        const m = n.match(/^(.+?)\s+[A-Z]\.?$/);
        if (m) out.push(m[1].trim());
        return out;
      };
      if (!nameForms(winnerName).some((n) => article.includes(n))) {
        issues.push({
          code: "winner_mismatch",
          message: `Bài viết không nhắc đến người thắng ${winnerName} (hoặc dạng rút gọn)`,
          blocking: true,
        });
      }
      if (!nameForms(loserName).some((n) => article.includes(n))) {
        issues.push({
          code: "winner_mismatch",
          message: `Bài viết không nhắc đến người thua ${loserName} (hoặc dạng rút gọn)`,
          blocking: true,
        });
      }
    }
  } else {
    const fe = evidence as FootballMatchEvidence;
    if (fe.facts.finalScore) {
      const variants: string[] = [];
      const home = fe.facts.finalScore.home;
      const away = fe.facts.finalScore.away;
      variants.push(`${home}-${away}`, `${away}-${home}`);
      if (!variants.some((v) => article.includes(v))) {
        issues.push({
          code: "score_mismatch",
          message: `Bài viết không chứa tỉ số chung cuộc ${home}-${away} hoặc ${away}-${home}`,
          blocking: true,
        });
      }
    }
    if (fe.facts.winnerSide !== null) {
      const winnerName =
        fe.facts.winnerSide === 1 ? fe.facts.home.name : fe.facts.away.name;
      const loserName =
        fe.facts.winnerSide === 1 ? fe.facts.away.name : fe.facts.home.name;
      const nameForms = (n: string): string[] => {
        const out = [n];
        const m = n.match(/^(.+?)\s+[A-Z]\.?$/);
        if (m) out.push(m[1].trim());
        return out;
      };
      if (!nameForms(winnerName).some((n) => article.includes(n))) {
        issues.push({
          code: "winner_mismatch",
          message: `Bài viết không nhắc đến đội thắng ${winnerName} (hoặc dạng rút gọn)`,
          blocking: true,
        });
      }
      if (!nameForms(loserName).some((n) => article.includes(n))) {
        issues.push({
          code: "winner_mismatch",
          message: `Bài viết không nhắc đến đội thua ${loserName} (hoặc dạng rút gọn)`,
          blocking: true,
        });
      }
    }
  }

  // Unknown evidence IDs (collected from usedIds vs evidence ids).
  const knownIds = new Set(evidence.evidenceIds);
  for (const id of envelope.evidenceIdsUsed) {
    if (!knownIds.has(id)) {
      issues.push({
        code: "unknown_evidence_id",
        message: `evidenceIdsUsed chứa ID không tồn tại: ${id}`,
        blocking: true,
      });
    }
  }

  // sourceMode consistency.
  if (envelope.sourceMode === "api-plus-web" && evidence.sources.length === 0) {
    issues.push({
      code: "external_source_unavailable",
      message: "sourceMode là api-plus-web nhưng evidence.sources rỗng",
      blocking: false,
    });
  }
  if (envelope.sourceMode === "api-only") {
    const cites = article.match(/\[web-\d+\]/g);
    if (cites && cites.length > 0) {
      issues.push({
        code: "false_source_claim",
        message: `sourceMode=api-only nhưng bài viết có citation web: ${cites.join(", ")}`,
        blocking: true,
      });
    }
  }

  // Numeric mention check: any number not in the evidence that is also
  // not in a tournament/date/time block is a potential stat invention.
  const numbers = extractNumbers(article);
  for (const n of numbers) {
    if (!wordMatchesInEvidence(n, evidence)) {
      // Skip 4-digit years that look like dates — they belong to start
      // time, tournament names, or generic years.
      const nInt = parseInt(n, 10);
      if (nInt >= 1900 && nInt <= 2100) continue;
      // Skip single-digit numbers that are likely ordinals / generic counts.
      if (nInt < 10 && n.length === 1) continue;
      issues.push({
        code: "stat_number_invented",
        message: `Số ${n} xuất hiện trong bài viết nhưng không có trong evidence`,
        blocking: true,
      });
      break; // one is enough to reject
    }
  }

  // Word count bounds.
  if (wordCount < SOFT_MIN_WORDS) {
    issues.push({
      code: "word_count_short",
      message: `Bài viết ${wordCount} từ, dưới mức khuyến nghị ${SOFT_MIN_WORDS}`,
      blocking: false,
    });
  }
  if (wordCount > HARD_MAX_WORDS) {
    issues.push({
      code: "word_count_long",
      message: `Bài viết ${wordCount} từ, vượt giới hạn cứng ${HARD_MAX_WORDS}`,
      blocking: true,
    });
  } else if (wordCount > SOFT_MAX_WORDS) {
    issues.push({
      code: "word_count_long",
      message: `Bài viết ${wordCount} từ, vượt khuyến nghị ${SOFT_MAX_WORDS}`,
      blocking: false,
    });
  }

  // Optional metadata: status / surface (tennis) / outcome (football).
  // These are non-blocking because the LLM can choose to omit them.
  if (evidence.sport === "tennis") {
    const te = evidence as TennisMatchEvidence;
    if (te.facts.round === "Unknown") {
      issues.push({
        code: "optional_metadata_missing",
        message: "Vòng đấu tennis không rõ (evidence.round=Unknown)",
        blocking: false,
      });
    }
  } else {
    const fe = evidence as FootballMatchEvidence;
    if (fe.facts.round === "") {
      issues.push({
        code: "optional_metadata_missing",
        message: "Vòng đấu football không rõ",
        blocking: false,
      });
    }
  }

  const blockingCount = issues.filter((i) => i.blocking).length;
  return {
    ok: blockingCount === 0,
    envelope,
    issues,
    blockingCount,
  };
}

/** Build a short repair prompt. Reuses the same evidence, lists the
 *  blocking issue codes, and asks for one more clean JSON envelope.
 *  Caps the response at the same token budget as the initial call. */
export function buildRepairPrompt(
  originalPrompt: string,
  evidence: MatchEvidence,
  issues: ValidationIssue[],
  finishReason?: string
): string {
  const issueLines = issues.map((i) => `- [${i.code}] ${i.message}`).join("\n");
  const truncatedNote =
    finishReason === "max_tokens" || finishReason === "length"
      ? "\n\nLưu ý: response trước bị truncate ở max_tokens. Hãy viết NGẮN GỌN hơn để tránh bị cắt."
      : "";
  return (
    `${originalPrompt.trim()}\n\n` +
    `## Repair\n\nResponse trước bị validator reject vì các lỗi sau:\n${issueLines}${truncatedNote}\n\n` +
    `Hãy viết LẠI MỘT JSON envelope duy nhất (KHÔNG preamble, KHÔNG Markdown fences, KHÔNG URL), tuân thủ mọi quy tắc ở trên. ` +
    `Mọi con số, tên, tỉ số, phút ghi bàn phải lấy từ evidence bên dưới. KHÔNG tự sửa evidence.\n\n` +
    `## Evidence (đã validate)\n\n` +
    "```json\n" + JSON.stringify(evidence, null, 2) + "\n```\n"
  );
}
