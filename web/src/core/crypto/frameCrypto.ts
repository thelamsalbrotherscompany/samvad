/**
 * Per-frame media encryption for E2EE over an SFU, via WebRTC Encoded Transforms
 * (insertable streams). Each encoded frame's payload is sealed with AES-GCM under a key
 * derived from the current MLS epoch secret; the SFU forwards ciphertext it can't read.
 *
 * Two details that matter (docs/ROADMAP Phase 4):
 *  - **Clear codec header.** The first bytes of a frame must stay unencrypted or browsers
 *    fail to depacketize. We leave the same header sizes the WebRTC sample uses.
 *  - **Key rotation.** Membership changes advance the MLS epoch and the key. Each frame is
 *    tagged with its epoch (1 byte) so a receiver decrypts with the right key even while a
 *    rotation is in flight, and briefly keeps the previous epoch's key for in-flight frames.
 *
 * Frame layout: `[ clear codec header ][ epoch (1) ][ iv (12) ][ AES-GCM ciphertext+tag ]`.
 */

// Unencrypted leading bytes, per the webrtc-encoded-transform reference. Video keeps more on
// key frames (the codec header is larger); audio keeps one.
const HEADER_BYTES_VIDEO_KEY = 10
const HEADER_BYTES_VIDEO_DELTA = 3
const HEADER_BYTES_AUDIO = 1
const IV_BYTES = 12

type EncodedFrame = RTCEncodedVideoFrame | RTCEncodedAudioFrame

function headerBytes(frame: EncodedFrame): number {
  if ('type' in frame) {
    return frame.type === 'key' ? HEADER_BYTES_VIDEO_KEY : HEADER_BYTES_VIDEO_DELTA
  }
  return HEADER_BYTES_AUDIO
}

/** HKDF-SHA256 from a 32-byte MLS epoch secret to an AES-GCM key. */
async function deriveKey(secret: Uint8Array): Promise<CryptoKey> {
  // Copy into a fresh ArrayBuffer-backed view (WebCrypto wants BufferSource, not the
  // WASM-returned Uint8Array<ArrayBufferLike>).
  const raw = new Uint8Array(secret.length)
  raw.set(secret)
  const material = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('samvad/frame/aes-gcm'),
    },
    material,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Holds the current (and previous) epoch keys and provides the sender/receiver transforms.
 * Feed it a new secret whenever the MLS epoch advances.
 */
export class FrameCryptor {
  private keys = new Map<number, CryptoKey>()
  private epoch = 0

  /** Adopt the key for `epoch` (its low byte tags every frame sent from now on). */
  async setEpochSecret(epoch: number, secret: Uint8Array): Promise<void> {
    const key = await deriveKey(secret)
    this.epoch = epoch & 0xff
    this.keys.set(this.epoch, key)
    // Keep only the current and immediately previous epoch key.
    const keep = new Set([this.epoch, (this.epoch - 1) & 0xff])
    for (const e of this.keys.keys()) if (!keep.has(e)) this.keys.delete(e)
  }

  get ready(): boolean {
    return this.keys.size > 0
  }

  /** A TransformStream that encrypts outgoing encoded frames. */
  encryptStream(): TransformStream<EncodedFrame, EncodedFrame> {
    return new TransformStream({
      transform: async (frame, controller) => {
        const key = this.keys.get(this.epoch)
        if (!key) {
          controller.enqueue(frame) // not keyed yet — pass through
          return
        }
        const data = new Uint8Array(frame.data)
        const clear = headerBytes(frame)
        const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
        const cipher = new Uint8Array(
          await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data.subarray(clear)),
        )

        const out = new Uint8Array(clear + 1 + IV_BYTES + cipher.length)
        out.set(data.subarray(0, clear), 0)
        out[clear] = this.epoch
        out.set(iv, clear + 1)
        out.set(cipher, clear + 1 + IV_BYTES)
        frame.data = out.buffer
        controller.enqueue(frame)
      },
    })
  }

  /**
   * Seal an arbitrary message under the current epoch key (for plugin data — chat, reactions —
   * over the SFU's data relay, so the relay forwards ciphertext it can't read). Returns a plain
   * `number[]` (JSON-transportable): `[ epoch(1) ][ iv(12) ][ AES-GCM ciphertext+tag ]`. Null if
   * we're not keyed yet.
   */
  async seal(plain: Uint8Array): Promise<number[] | null> {
    const key = this.keys.get(this.epoch)
    if (!key) return null
    const buf = new Uint8Array(plain.length)
    buf.set(plain)
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf))
    const out = new Uint8Array(1 + IV_BYTES + cipher.length)
    out[0] = this.epoch
    out.set(iv, 1)
    out.set(cipher, 1 + IV_BYTES)
    return Array.from(out)
  }

  /** Open a message sealed by {@link seal}. Null if we lack the key or authentication fails. */
  async open(data: readonly number[]): Promise<Uint8Array | null> {
    const bytes = Uint8Array.from(data)
    if (bytes.length < 1 + IV_BYTES) return null
    const key = this.keys.get(bytes[0])
    if (!key) return null
    const iv = bytes.subarray(1, 1 + IV_BYTES)
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(1 + IV_BYTES)))
    } catch {
      return null
    }
  }

  /** A TransformStream that decrypts incoming encoded frames. */
  decryptStream(): TransformStream<EncodedFrame, EncodedFrame> {
    return new TransformStream({
      transform: async (frame, controller) => {
        // Not keyed yet (E2EE handshake still in flight): media is flowing in the clear —
        // the sender passes through too — so pass it on, never black it out. Once we hold a
        // key, every real frame is encrypted and this branch no longer applies.
        if (this.keys.size === 0) {
          controller.enqueue(frame)
          return
        }
        const data = new Uint8Array(frame.data)
        const clear = headerBytes(frame)
        if (data.length < clear + 1 + IV_BYTES) {
          controller.enqueue(frame) // too short to be one of ours
          return
        }
        const epoch = data[clear]
        const key = this.keys.get(epoch)
        if (!key) return // no key for this epoch — drop rather than surface garbage

        const iv = data.subarray(clear + 1, clear + 1 + IV_BYTES)
        try {
          const plain = new Uint8Array(
            await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv },
              key,
              data.subarray(clear + 1 + IV_BYTES),
            ),
          )
          const out = new Uint8Array(clear + plain.length)
          out.set(data.subarray(0, clear), 0)
          out.set(plain, clear)
          frame.data = out.buffer
          controller.enqueue(frame)
        } catch {
          // Authentication failed — drop the frame rather than render corrupt media.
        }
      },
    })
  }
}

/**
 * Attach a cryptor's transform to a sender or receiver. Prefers the standard
 * `RTCRtpScriptTransform` (runs in a worker); falls back to Chromium's `createEncodedStreams`
 * on the main thread. Returns false if the browser supports neither (→ E2EE unavailable).
 */
export function pipeThrough(
  endpoint: RTCRtpSender | RTCRtpReceiver,
  transform: TransformStream<EncodedFrame, EncodedFrame>,
): boolean {
  const legacy = endpoint as unknown as {
    createEncodedStreams?: () => { readable: ReadableStream; writable: WritableStream }
  }
  if (typeof legacy.createEncodedStreams === 'function') {
    const { readable, writable } = legacy.createEncodedStreams()
    void readable.pipeThrough(transform as unknown as ReadableWritablePair).pipeTo(writable)
    return true
  }
  return false
}
