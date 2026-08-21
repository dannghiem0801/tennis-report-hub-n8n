/**
 * OAuth token management cho Vercel serverless functions.
 * Đọc GOOGLE_TOKEN_JSON từ env, dùng token hiện tại hoặc refresh khi hết hạn.
 */

export interface GoogleCreds {
  token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  token_uri?: string;
  expiry?: string;
  account?: string;
}

export function parseCreds(): GoogleCreds {
  const raw = process.env.GOOGLE_TOKEN_JSON;
  if (!raw) throw new Error("GOOGLE_TOKEN_JSON chưa được cấu hình trong Vercel env");
  return JSON.parse(raw) as GoogleCreds;
}

export async function getAccessToken(): Promise<{ token: string; email: string }> {
  const creds = parseCreds();
  const expiry = creds.expiry ? new Date(creds.expiry).getTime() : 0;
  const now = Date.now();
  // Còn hơn 60s thì dùng token hiện tại (không gọi network)
  if (creds.token && expiry > now + 60_000) {
    return { token: creds.token, email: creds.account || "" };
  }
  // Refresh qua token endpoint
  const params = new URLSearchParams({
    client_id: creds.client_id ?? "",
    client_secret: creds.client_secret ?? "",
    refresh_token: creds.refresh_token ?? "",
    grant_type: "refresh_token",
  });
  const resp = await fetch(creds.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Refresh token thất bại: ${resp.status} ${body.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { access_token?: string };
  return { token: data.access_token ?? "", email: creds.account || "" };
}
