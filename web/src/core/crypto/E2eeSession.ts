import { createMlsSession, type MlsSession } from './e2ee'
import { FrameCryptor } from './frameCrypto'

/**
 * Drives MLS group key agreement for a room and keeps a {@link FrameCryptor} keyed to the
 * current epoch. It is the *delivery service* the MLS spec assumes: it ferries handshake
 * bytes (key packages, commits, welcomes) between clients over the app's existing E2EE data
 * channel — it never touches the crypto itself (OpenMLS does, in WASM).
 *
 * Model (kept simple and glare-free): the **host is the sole committer**. Everyone publishes
 * a key package; the host adds each admitted peer, broadcasting a commit (so existing members
 * advance) and unicasting a welcome (so the newcomer joins). Membership changes rotate the
 * key; {@link cryptor} is updated each epoch.
 *
 * The MLS core beneath this is covered by native tests (`crypto/mls/tests/`). This
 * coordination layer is built but **not yet wired into a live call** — it activates with the
 * SFU transport, where an unreadable relay actually needs it. Known gaps for that wiring:
 * host handoff (the committer role must transfer), and concurrent-add ordering.
 */

const TOPIC = 'e2ee/mls'

type Wire =
  | { k: 'kp'; b: number[] } // a published key package
  | { k: 'commit'; b: number[] } // advance to the next epoch
  | { k: 'welcome'; b: number[] } // (unicast) join the group

type DataApi = {
  send: (topic: string, payload: unknown, opts?: { to?: string }) => void
  subscribe: (topic: string, handler: (payload: unknown, from: string) => void) => () => void
}

export class E2eeSession {
  readonly cryptor = new FrameCryptor()

  private mls: MlsSession | null = null
  private off: (() => void) | null = null
  private isHost = false
  private joined = false // are we in the group yet? (host: after create; member: after welcome)
  private started = false
  private readonly added = new Set<string>() // peers the host has already added
  private readonly pendingKp = new Map<string, Uint8Array>() // key packages awaiting an add

  private readonly identity: string
  private readonly data: DataApi

  /** `identity` should be a stable per-participant id (the transport's peer id). */
  constructor(identity: string, data: DataApi) {
    this.identity = identity
    this.data = data
  }

  async start(isHost: boolean): Promise<void> {
    if (this.started) return
    this.started = true
    this.isHost = isHost
    this.mls = await createMlsSession(this.identity)
    this.off = this.data.subscribe(TOPIC, (payload, from) => {
      void this.onMessage(payload as Wire, from)
    })

    if (isHost) {
      this.mls.createGroup()
      this.joined = true
      await this.refreshKey()
      // Any key packages already collected can be added now.
      for (const peer of this.pendingKp.keys()) this.tryAdd(peer)
    }
    // Publish our key package so the host can admit us (the host's is harmless/ignored).
    this.data.send(TOPIC, { k: 'kp', b: bytes(this.mls.keyPackage()) })
  }

  /** The host role moved to (or from) us. */
  setHost(isHost: boolean): void {
    this.isHost = isHost
    if (isHost) for (const peer of this.pendingKp.keys()) this.tryAdd(peer)
  }

  /** A peer was admitted to the room — the host adds them to the group (once we have their kp). */
  onPeerJoined(peerId: string): void {
    if (this.isHost) this.tryAdd(peerId)
  }

  /** A peer left — the host removes them, rotating the key so they can't read new media. */
  onPeerLeft(peerId: string): void {
    if (!this.isHost || !this.mls) return
    this.added.delete(peerId)
    this.pendingKp.delete(peerId)
    const index = this.leafIndexOf(peerId)
    if (index < 0) return
    try {
      const commit = this.mls.removeMember(index)
      this.data.send(TOPIC, { k: 'commit', b: bytes(commit) })
      void this.refreshKey()
    } catch {
      // A concurrent change already moved the tree — the next commit reconciles.
    }
  }

  stop(): void {
    this.off?.()
    this.off = null
    this.mls = null
    this.joined = false
    this.started = false
    this.added.clear()
    this.pendingKp.clear()
  }

  private async onMessage(msg: Wire, from: string): Promise<void> {
    if (!this.mls) return
    switch (msg.k) {
      case 'kp':
        this.pendingKp.set(from, Uint8Array.from(msg.b))
        if (this.isHost) this.tryAdd(from)
        break
      case 'commit':
        // Ignore commits until we're in the group — the welcome brings us to the right epoch,
        // including the very commit that added us.
        if (!this.joined) return
        try {
          this.mls.process(Uint8Array.from(msg.b))
          await this.refreshKey()
        } catch {
          // Not applicable to our current epoch — safe to drop.
        }
        break
      case 'welcome':
        if (this.joined) return
        try {
          this.mls.join(Uint8Array.from(msg.b))
          this.joined = true
          await this.refreshKey()
        } catch {
          // Not our welcome (unicast should prevent this, but be defensive).
        }
        break
    }
  }

  private tryAdd(peerId: string): void {
    if (!this.mls || !this.joined || this.added.has(peerId)) return
    const kp = this.pendingKp.get(peerId)
    if (!kp) return
    try {
      const add = this.mls.addMember(kp)
      this.added.add(peerId)
      this.data.send(TOPIC, { k: 'commit', b: bytes(add.commit) })
      this.data.send(TOPIC, { k: 'welcome', b: bytes(add.welcome) }, { to: peerId })
      void this.refreshKey()
    } catch {
      // Retry on the next kp/commit if the add didn't take.
    }
  }

  private leafIndexOf(identity: string): number {
    try {
      return this.mls?.members().indexOf(identity) ?? -1
    } catch {
      return -1
    }
  }

  private async refreshKey(): Promise<void> {
    if (!this.mls) return
    try {
      const epoch = Number(this.mls.epoch())
      await this.cryptor.setEpochSecret(epoch, this.mls.frameSecret())
    } catch {
      // No group yet, or transient — the next event re-derives.
    }
  }
}

/** Uint8Array → plain number[] so it survives JSON transport over the data channel. */
function bytes(u: Uint8Array): number[] {
  return Array.from(u)
}
