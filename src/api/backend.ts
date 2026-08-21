/**
 * Backend client — gọi Vercel serverless functions (/api/*).
 * Cùng origin nên không cần CORS config phức tạp.
 *
 * Contract (xem api/matches.ts):
 *   POST /api/matches  {sport, match, youtube_link} → {row_index, status, tab}
 *   GET  /api/matches?tab=Tennis → {tab, rows: [...]}
 */

export interface BackendMatchRow {
  row_index: number;
  Match?: string;
  "Link Youtube"?: string;
  Status?: string;
  "Report (tennis-recap)"?: string;
  "Report (soccer-recap)"?: string;
  "Link Google Drive(youtube-to-drive)"?: string;
}

export type Sport = "tennis" | "soccer";

export interface SubmitMatchPayload {
  sport: Sport;
  match: string;
  youtube_link?: string;
}

export interface SubmitMatchResult {
  row_index: number;
  status: string;
  tab: string;
}

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

/** Gửi một trận đấu vào pipeline (append row vào Google Sheet → n8n xử lý). */
export async function submitMatch(payload: SubmitMatchPayload): Promise<SubmitMatchResult> {
  return request<SubmitMatchResult>("/matches", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Lấy danh sách trận từ sheet (theo tab). */
export async function getMatches(tab: Sport = "tennis"): Promise<BackendMatchRow[]> {
  const data = await request<{ rows: BackendMatchRow[] }>(
    `/matches?tab=${tab === "soccer" ? "Soccer" : "Tennis"}`
  );
  return data.rows || [];
}

/** Helper: đọc report từ row (tên cột phụ thuộc tab). */
export function getReportFromRow(row: BackendMatchRow, sport: Sport): string {
  if (sport === "soccer") return row["Report (soccer-recap)"] || "";
  return row["Report (tennis-recap)"] || "";
}

/** Helper: Drive link từ row. */
export function getDriveLinkFromRow(row: BackendMatchRow): string {
  return row["Link Google Drive(youtube-to-drive)"] || "";
}
