import type { VercelRequest, VercelResponse } from '@vercel/node';

const GATEWAY_URL = 'http://100.89.83.117:8644';
const WEBHOOK_PATH = '/webhooks/sheets-recap';

/**
 * GAS → Vercel → Hermes gateway relay
 * 
 * GAS calls this endpoint, Vercel forwards to the local gateway.
 * This bypasses the Tailscale-only restriction since Vercel (AWS)
 * can reach the Tailscale IP from the internet.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;

  // Forward to gateway
  try {
    const gatewayRes = await fetch(`${GATEWAY_URL}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward HMAC signature if present
        ...(req.headers['x-hub-signature-256'] && {
          'X-Hub-Signature-256': req.headers['x-hub-signature-256'] as string,
        }),
      },
      body: JSON.stringify(body),
    });

    const text = await gatewayRes.text();
    return res.status(gatewayRes.status).json(
      gatewayRes.status >= 200 && gatewayRes.status < 300
        ? { status: 'forwarded', gateway: JSON.parse(text) }
        : { status: 'gateway_error', detail: text }
    );
  } catch (err: any) {
    return res.status(502).json({ error: 'Gateway unreachable', detail: err.message });
  }
}
