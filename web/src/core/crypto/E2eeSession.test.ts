import { test, expect } from 'bun:test'
import { E2eeSession } from './E2eeSession'

/**
 * End-to-end test of the E2EE coordinator over an in-memory stand-in for the DO data relay:
 * a host and a guest run the real MLS handshake (OpenMLS WASM) and must end up able to
 * decrypt each other's frames — i.e. they derived the *same* group key. This is the
 * coordinator logic PionTransport drives; here it runs with no browser and no SFU.
 */

type Handler = (payload: unknown, from: string) => void

/** A synchronous broadcast/unicast bus keyed by participant id — the DO relay, in memory. */
function makeBus() {
  const subs = new Map<string, Map<string, Handler>>()
  return {
    api(id: string) {
      return {
        send: (topic: string, payload: unknown, opts?: { to?: string }) => {
          for (const [other, topics] of subs) {
            if (other === id) continue
            if (opts?.to && other !== opts.to) continue
            topics.get(topic)?.(payload, id)
          }
        },
        subscribe: (topic: string, handler: Handler) => {
          let m = subs.get(id)
          if (!m) {
            m = new Map()
            subs.set(id, m)
          }
          m.set(topic, handler)
          return () => m?.delete(topic)
        },
      }
    },
  }
}

type MockFrame = { type?: 'key' | 'delta'; data: ArrayBuffer }

async function through(ts: TransformStream, f: MockFrame): Promise<MockFrame | null> {
  const out: MockFrame[] = []
  const drained = ts.readable.pipeTo(new WritableStream({ write: (c) => void out.push(c as MockFrame) }))
  const w = ts.writable.getWriter()
  await w.write(f as unknown)
  await w.close()
  await drained
  return out[0] ?? null
}

const settle = () => new Promise((r) => setTimeout(r, 800))

test('host and guest complete the MLS handshake and agree on the frame key', async () => {
  const bus = makeBus()
  const host = new E2eeSession('host', bus.api('host'))
  const guest = new E2eeSession('guest', bus.api('guest'))

  await host.start(true)
  await guest.start(false)
  host.onPeerJoined('guest') // host admits the guest into the group
  await settle()

  // Both sides derived a key from the same group.
  expect(host.cryptor.ready).toBe(true)
  expect(guest.cryptor.ready).toBe(true)

  // The real proof of agreement: what the host encrypts, the guest can decrypt.
  const header = 10
  const body = [42, 43, 44, 45, 46]
  const bytes = new Uint8Array(header + body.length)
  for (let i = 0; i < header; i++) bytes[i] = i + 1
  bytes.set(body, header)

  const enc = await through(host.cryptor.encryptStream(), { type: 'key', data: bytes.buffer })
  expect(enc).not.toBeNull()
  const dec = await through(guest.cryptor.decryptStream(), enc!)
  expect(dec).not.toBeNull()
  expect(Array.from(new Uint8Array(dec!.data).subarray(header))).toEqual(body)

  host.stop()
  guest.stop()
})

test('removing the guest rotates the key so it can no longer decrypt', async () => {
  const bus = makeBus()
  const host = new E2eeSession('host', bus.api('host'))
  const guest = new E2eeSession('guest', bus.api('guest'))

  await host.start(true)
  await guest.start(false)
  host.onPeerJoined('guest')
  await settle()
  expect(guest.cryptor.ready).toBe(true)

  // Host removes the guest — the group key rotates.
  host.onPeerLeft('guest')
  await settle()

  // A frame the host encrypts under the new epoch: the removed guest must NOT decrypt it.
  const bytes = new Uint8Array(14)
  for (let i = 0; i < 10; i++) bytes[i] = i + 1
  bytes.set([7, 7, 7, 7], 10)
  const enc = await through(host.cryptor.encryptStream(), { type: 'key', data: bytes.buffer })
  const dec = await through(guest.cryptor.decryptStream(), enc!)
  expect(dec).toBeNull() // post-removal secrecy: the ex-member can't read new media

  host.stop()
  guest.stop()
})
