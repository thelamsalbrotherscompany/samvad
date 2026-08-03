import init, { MlsSession } from './mls/samvad_mls.js'

/**
 * The application-layer E2EE entry point (docs/ROADMAP Phase 4). MLS (RFC 9420, via OpenMLS
 * compiled to WASM) gives the room a shared per-epoch secret with forward secrecy and
 * cryptographic membership; {@link FrameCryptor} turns that secret into per-frame AES-GCM on
 * the media, via insertable streams. Together they let media flow through an SFU that
 * **cannot read it** — the property the mesh gets for free but a relay does not.
 *
 * The app is only the *delivery service*: it ferries the MLS handshake bytes (key packages,
 * commits, welcomes) between clients over the existing E2EE data channel. Samvad writes no
 * crypto of its own — OpenMLS and WebCrypto do it (a non-negotiable).
 *
 * Not yet wired into a transport: the mesh is already E2EE by construction (DTLS-SRTP, no
 * middlebox), so this layer activates only once media flows through the SFU. It's built,
 * loads on demand, and is ready for that wiring.
 */

let ready: Promise<void> | null = null

/** Load the MLS WASM once (lazily — nothing downloads until E2EE is actually used). */
export function ensureMlsReady(): Promise<void> {
  if (!ready) ready = init().then(() => undefined)
  return ready
}

/** Create an MLS session for this participant. Initialises the WASM on first use. */
export async function createMlsSession(identity: string): Promise<MlsSession> {
  await ensureMlsReady()
  return new MlsSession(identity)
}

export { MlsSession }
export type { AddResult } from './mls/samvad_mls.js'
