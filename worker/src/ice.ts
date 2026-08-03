/**
 * ICE server list for the browser's peer connections.
 *
 * TURN relays media for the ~15% of networks (symmetric NAT, strict firewalls) where a
 * direct P2P connection can't be established. Cloudflare Realtime provides TURN; minting
 * its credentials requires a secret API token, which must never reach the browser — so
 * this runs in the Worker and hands the client only short-lived, scoped credentials.
 *
 * Crucially, TURN here is a *relay of encrypted RTP*, not a media service: it forwards
 * packets it cannot read. That keeps it inside the non-negotiables — no middlebox ever
 * decrypts (docs/ARCHITECTURE.md §7, docs/THREAT-MODEL.md).
 *
 * With no credentials configured, this returns STUN only: a direct-only mesh that still
 * connects on the large majority of networks. TURN is an availability upgrade, opt-in via
 * environment, never a hard dependency.
 */

export type IceServer = {
  urls: string | string[]
  username?: string
  credential?: string
}

export type IceEnv = {
  // Cloudflare Realtime TURN key id + API token, set as Worker secrets:
  //   bunx wrangler secret put TURN_KEY_ID
  //   bunx wrangler secret put TURN_API_TOKEN
  TURN_KEY_ID?: string
  TURN_API_TOKEN?: string
}

const STUN: IceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]

export async function iceServers(env: IceEnv): Promise<IceServer[]> {
  const keyId = env.TURN_KEY_ID
  const apiToken = env.TURN_API_TOKEN
  if (!keyId || !apiToken) return STUN

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        // 24h — comfortably longer than any call, so creds never expire mid-session.
        body: JSON.stringify({ ttl: 86_400 }),
      },
    )
    if (!res.ok) return STUN
    const data = (await res.json()) as { iceServers?: IceServer }
    if (!data.iceServers) return STUN
    // Cloudflare returns one entry (TURN urls + creds); keep STUN alongside as a
    // direct-path fallback the browser tries first.
    return [data.iceServers, ...STUN]
  } catch {
    // Network hiccup reaching Cloudflare — degrade to STUN rather than fail the call.
    return STUN
  }
}
