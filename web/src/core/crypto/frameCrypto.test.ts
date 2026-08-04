import { test, expect } from 'bun:test'
import { FrameCryptor } from './frameCrypto'

/**
 * Verifies the actual per-frame cipher end-to-end (WebCrypto AES-GCM), the way two parties
 * use it over the SFU: sender encrypts with the epoch key, receiver decrypts with the same
 * key and gets the exact bytes back — with the clear codec header preserved. Runs under
 * `bun test` (no browser); encoded frames are mocked as `{ type?, data }`, which is all the
 * transforms read.
 */

type MockFrame = { type?: 'key' | 'delta'; data: ArrayBuffer }

const SECRET_A = new Uint8Array(32).fill(7)
const SECRET_B = new Uint8Array(32).fill(9)

/** Build a frame: `header` clear bytes followed by a `body` payload. */
function frame(type: 'key' | 'delta' | 'audio', header: number, body: number[]): MockFrame {
  const bytes = new Uint8Array(header + body.length)
  for (let i = 0; i < header; i++) bytes[i] = i + 1
  bytes.set(body, header)
  return type === 'audio' ? { data: bytes.buffer } : { type, data: bytes.buffer }
}

/**
 * Push one frame through a transform and return the output, or null if it was dropped (the
 * decryptor drops on auth failure). Fully closes both ends so no dangling stream keeps the
 * test runner's event loop alive.
 */
async function through(ts: TransformStream, f: MockFrame): Promise<MockFrame | null> {
  const out: MockFrame[] = []
  const drained = ts.readable.pipeTo(
    new WritableStream({
      write(chunk) {
        out.push(chunk as MockFrame)
      },
    }),
  )
  const writer = ts.writable.getWriter()
  await writer.write(f as unknown)
  await writer.close()
  await drained
  return out[0] ?? null
}

test('a video key frame round-trips between two parties with the same epoch key', async () => {
  const sender = new FrameCryptor()
  const receiver = new FrameCryptor()
  await sender.setEpochSecret(1, SECRET_A)
  await receiver.setEpochSecret(1, SECRET_A)

  const original = [100, 101, 102, 103, 200, 201, 202, 203]
  const f = frame('key', 10, original)

  const enc = await through(sender.encryptStream(), f)
  expect(enc).not.toBeNull()
  // The payload is now ciphertext — not the plaintext body.
  const encBytes = new Uint8Array(enc!.data)
  expect(encBytes.length).toBeGreaterThan(10 + original.length) // grew by epoch+iv+tag
  expect(Array.from(encBytes.subarray(10, 10 + original.length))).not.toEqual(original)

  const dec = await through(receiver.decryptStream(), enc!)
  const decBytes = new Uint8Array(dec!.data)
  // Clear header preserved, body recovered exactly.
  expect(Array.from(decBytes.subarray(0, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  expect(Array.from(decBytes.subarray(10))).toEqual(original)
})

test('audio and delta frames keep the correct clear-header size', async () => {
  const c = new FrameCryptor()
  await c.setEpochSecret(3, SECRET_A)

  for (const [type, header] of [
    ['audio', 1],
    ['delta', 3],
  ] as const) {
    const body = [11, 22, 33, 44]
    const enc = await through(c.encryptStream(), frame(type, header, body))
    const dec = await through(c.decryptStream(), enc!)
    expect(Array.from(new Uint8Array(dec!.data).subarray(header))).toEqual(body)
  }
})

test('a different key cannot decrypt (auth fails → frame dropped)', async () => {
  const sender = new FrameCryptor()
  const wrong = new FrameCryptor()
  await sender.setEpochSecret(1, SECRET_A)
  await wrong.setEpochSecret(1, SECRET_B) // same epoch tag, different secret

  const enc = await through(sender.encryptStream(), frame('key', 10, [5, 6, 7, 8]))
  const out = await through(wrong.decryptStream(), enc!)
  expect(out).toBeNull() // GCM auth failure → dropped, never surfaced as garbage
})

test('key rotation: the receiver keeps the previous epoch key for in-flight frames', async () => {
  const sender = new FrameCryptor()
  const receiver = new FrameCryptor()
  await sender.setEpochSecret(1, SECRET_A)
  await receiver.setEpochSecret(1, SECRET_A)

  // A frame encrypted under epoch 1, still arriving after the receiver advanced to epoch 2.
  const inflight = await through(sender.encryptStream(), frame('key', 10, [9, 8, 7]))
  await receiver.setEpochSecret(2, SECRET_B)

  const dec = await through(receiver.decryptStream(), inflight!)
  expect(Array.from(new Uint8Array(dec!.data).subarray(10))).toEqual([9, 8, 7])
})

test('before any key, frames pass through in the clear (ramp-up never blacks out media)', async () => {
  const cryptor = new FrameCryptor()
  expect(cryptor.ready).toBe(false)

  const body = [1, 2, 3, 4, 5]
  const enc = await through(cryptor.encryptStream(), frame('key', 10, body))
  expect(Array.from(new Uint8Array(enc!.data).subarray(10))).toEqual(body) // unchanged
  const dec = await through(cryptor.decryptStream(), enc!)
  expect(Array.from(new Uint8Array(dec!.data).subarray(10))).toEqual(body) // passed through
})
