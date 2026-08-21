/**
 * Google Sheets API access qua OAuth token (tự refresh).
 * SPREADSHEET_ID của tracker tennis/soccer pipeline.
 */

import { getAccessToken } from "./token";

export const SPREADSHEET_ID = "1Q1LWnF3DhE9xHovdgqWG09ir4fc8gNJ6lht-aj3KPm4";

async function sheetsApi<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const { token } = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/${path}`;
  const resp = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Sheets API ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json() as Promise<T>;
}

export interface SheetRow {
  row_index: number;
  [key: string]: string | number;
}

/** Đọc toàn bộ rows của một tab (A1:E40), map header → value. */
export async function readTab(tab: string): Promise<SheetRow[]> {
  const data = await sheetsApi<{ values?: string[][] }>(`values/${tab}!A1:E40`);
  const values = data.values || [];
  if (values.length === 0) return [];
  const headers = values[0];
  return values.slice(1).map((row, i): SheetRow => {
    const obj: Record<string, string | number> = { row_index: i + 2 };
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    return obj as SheetRow;
  });
}

/** Append một dòng vào tab (A:B = Match + Link Youtube). Trả về row number. */
export async function appendRow(tab: string, matchLabel: string, youtubeLink: string): Promise<number> {
  const { token } = await getAccessToken();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${tab}!A:B:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [[matchLabel, youtubeLink || ""]] }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Append thất bại ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = (await resp.json()) as { updates?: { updatedRange?: string } };
  const range: string = data.updates?.updatedRange || "";
  const nums = range.match(/(\d+)/g);
  return nums ? parseInt(nums[nums.length - 1], 10) : 0;
}
