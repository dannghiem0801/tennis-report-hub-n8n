/**
 * Vite dev plugin — "Save to .env.local" endpoint.
 *
 * Exposes `POST /__save-env` on the dev server so the Settings UI can
 * persist a key value back to `.env.local` without the user having to
 * edit the file by hand.
 *
 * Why this exists: Vite's `.env.local` is a BUILD-TIME resource. The
 * browser cannot write to disk, and the env values are inlined into
 * the bundle at startup. Without this endpoint, a UI edit only lands
 * in localStorage and gets clobbered on the next reload by whatever
 * is currently in `.env.local`. This middleware closes the loop:
 * UI edit → middleware → `.env.local` → Vite file-watcher → full
 * page reload → new env values pre-fill localStorage.
 *
 * Security model:
 *   - `apply: "serve"` → only runs in dev mode. Production builds
 *     have no dev server, so this plugin is automatically excluded.
 *   - `ALLOWED_KEY_RE` → only `VITE_*` and `LLM_PROXY_URL` accepted.
 *     Anything else returns 400. Prevents the UI (or a malicious
 *     page in the same origin) from writing arbitrary keys like
 *     `PATH` or `HOME`.
 *   - Values must be strings → no JSON objects / arrays.
 *   - File path is fixed to `.env.local` at project root → no path
 *     traversal via the URL.
 *
 * Value escaping: if a value contains whitespace, quotes, or other
 * characters that need protection, it is wrapped in double quotes
 * with internal quotes / backslashes escaped per the dotenv spec.
 */

import type { Plugin } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// Keep this list in sync with src/vite-env.d.ts. Adding a new
// VITE_-prefixed variable there is not enough — it must also be
// listed here, or the UI Save button will get a 400.
const ALLOWED_KEY_RE = /^(VITE_[A-Z0-9_]+|LLM_PROXY_URL)$/;

/**
 * Wrap a value in double quotes if it contains characters that would
 * otherwise be parsed incorrectly by dotenv loaders. Specifically:
 *   - whitespace (spaces, tabs) → without quotes the value gets split
 *   - quotes / backslashes → need escaping inside the quoted form
 *   - `$` → would trigger variable interpolation in some loaders
 *   - backticks → would be confusing in a comment-like context
 */
function quoteIfNeeded(value: string): string {
  if (/[\s"'\\$`]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Return a new file content string with `key=value` set:
 *   - If a line matching `^key=` (or `key=` with leading whitespace)
 *     exists, replace it in place.
 *   - Otherwise, append the line to the end of the file. If the file
 *     does not end with a newline, one is added first.
 */
function setKeyInContent(content: string, key: string, value: string): string {
  const lines = content.split("\n");
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const newLine = `${key}=${quoteIfNeeded(value)}`;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = newLine;
      return lines.join("\n");
    }
  }
  // Append — make sure we have a separating blank line if the file
  // already ends with content (otherwise the new key sticks to the
  // last line).
  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
  lines.push(newLine);
  return lines.join("\n");
}

async function readBody(req: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function envWriterPlugin(): Plugin {
  return {
    name: "tennis-report-hub:env-writer",
    apply: "serve",

    configureServer(server) {
      const envPath = path.resolve(process.cwd(), ".env.local");

      server.middlewares.use("/__save-env", async (req, res) => {
        // Method gate — anything other than POST gets 405. Catches
        // accidental GETs from a browser address bar.
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "Method not allowed" });
          return;
        }

        // Body parse
        let body: Record<string, unknown>;
        try {
          const raw = await readBody(req);
          body = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
          return;
        }

        if (!body || typeof body !== "object" || Array.isArray(body)) {
          sendJson(res, 400, { ok: false, error: "Body must be a JSON object of key/value strings" });
          return;
        }

        // Key + value validation
        const validated: Record<string, string> = {};
        for (const [key, value] of Object.entries(body)) {
          if (!ALLOWED_KEY_RE.test(key)) {
            sendJson(res, 400, {
              ok: false,
              error: `Key "${key}" không hợp lệ. Chỉ chấp nhận VITE_* hoặc LLM_PROXY_URL.`,
            });
            return;
          }
          if (typeof value !== "string") {
            sendJson(res, 400, {
              ok: false,
              error: `Value cho "${key}" phải là string, nhận được ${typeof value}.`,
            });
            return;
          }
          validated[key] = value;
        }

        if (Object.keys(validated).length === 0) {
          sendJson(res, 400, { ok: false, error: "Body rỗng — không có key nào để lưu." });
          return;
        }

        // Read existing .env.local (or start blank if it doesn't exist yet)
        let content = "";
        if (existsSync(envPath)) {
          try {
            content = await readFile(envPath, "utf-8");
          } catch (e) {
            sendJson(res, 500, { ok: false, error: `Không đọc được .env.local: ${(e as Error).message}` });
            return;
          }
        }

        // Apply each update
        for (const [key, value] of Object.entries(validated)) {
          content = setKeyInContent(content, key, value);
        }

        // Write back. create=false by default — the file should
        // already exist (we wrote .env.local at setup time), but
        // writeFile creates it if missing anyway.
        try {
          await writeFile(envPath, content, "utf-8");
        } catch (e) {
          sendJson(res, 500, { ok: false, error: `Không ghi được .env.local: ${(e as Error).message}` });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          wrote: Object.keys(validated),
          // Hint to the UI: Vite's file-watcher should detect the
          // change and trigger a full reload within ~1s. The UI
          // shows a toast with this message either way.
          note: "Vite sẽ tự reload ~1s. Nếu không thấy, Ctrl+C rồi npm run dev.",
        });
      });
    },
  };
}
