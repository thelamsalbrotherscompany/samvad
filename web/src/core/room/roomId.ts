/**
 * Room ids are the credential — knowing the link *is* the access (there are no
 * accounts), so an id must be unguessable. It is generated from the platform CSPRNG
 * (`crypto.getRandomValues`), never a word list: a friendly `warm-marigold-847` slug has
 * only ~500k combinations and can be enumerated to walk into live calls.
 *
 * ENTROPY: 80 bits (10 random bytes). Guessing is *online* — every attempt is a network
 * request to the room's Durable Object — so 2^80 is astronomically beyond any brute
 * force, and it also makes collisions negligible at millions of concurrent rooms
 * (birthday bound ≈ 2^40). Bump `ID_BYTES` for more; the encoding scales automatically.
 *
 * A passphrase-derived deterministic id (Argon2id → BLAKE2b, bound to the E2EE key) is a
 * separate, later feature for "same passphrase → same room"; it doesn't replace this.
 */

// Crockford base32, lowercased: no i/l/o/u, so ids don't get misread or mistyped.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const ID_BYTES = 10

export function generateRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES))
  let value = 0
  let bits = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += ALPHABET[(value >> bits) & 31]
      value &= (1 << bits) - 1
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Lowercase, url-safe, bounded. Empty string means "no valid room". */
export function normalizeRoomId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}
