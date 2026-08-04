import type { PeerInfo } from './protocol'

/**
 * The load-bearing transport contract (Claude.md). UI and app code talk to **this**, never
 * to a concrete transport. `MeshTransport` (P2P) implements it today; `RealtimeTransport`
 * (Cloudflare SFU) and `PionTransport` (self-hosted Go SFU) implement the same shape, so
 * swapping the media path never touches a line of UI — and keeps Cloudflare from ever
 * becoming a lock-in.
 */

export type RemotePeer = PeerInfo & {
  stream: MediaStream | null
  /** This peer's shared screen, when they're presenting. Null until it's flowing. */
  screenStream: MediaStream | null
}

/** Where you are relative to the room's lobby. */
export type Phase =
  | 'connecting'
  | 'waiting'
  | 'admitted'
  | 'denied'
  | 'removed'
  | 'ended'
  | 'not-found'

/** A join/left event, so the host can see who came and went mid-call. In-memory only. */
export type ActivityEvent = {
  id: string
  kind: 'joined' | 'left'
  name: string
  ts: number
}

/**
 * The REAL encryption mode of the media path, reported by the transport — never an
 * aspiration (Claude.md §6). Mesh is always `mesh-e2ee`. The SFU path is `hop-by-hop` until
 * per-frame encryption is confirmed active, then `sfu-e2ee`.
 */
export type EncryptionMode = 'mesh-e2ee' | 'sfu-e2ee' | 'hop-by-hop'

/** Callbacks a transport pushes up to the app. Same for every transport implementation. */
export type TransportHandlers = {
  onPeers: (peers: RemotePeer[]) => void
  onConnected: (connected: boolean) => void
  onPhase: (phase: Phase) => void
  onHost: (isHost: boolean) => void
  onKnocks: (knocks: PeerInfo[]) => void
  onLobbyOpen: (open: boolean) => void
  /** Plugin data on a topic (chat, reactions, …), from a peer. */
  onData: (topic: string, from: string, payload: unknown) => void
  onActivity: (e: ActivityEvent) => void
  /** The real, current encryption mode of the media path. */
  onEncryption: (mode: EncryptionMode) => void
  /** The host asked everyone to mute — the app mutes this client's own mic. */
  onForceMute: () => void
  /** The host cleared this client's raised hand — the app lowers it. */
  onForceLower: () => void
}

/**
 * The methods the app drives a transport with. Every implementation — mesh, SFU, self-host
 * — exposes exactly this, so `useMesh` and the UI are transport-agnostic.
 */
export interface Transport {
  connect(): void
  leave(): void
  /** Replace published camera/mic tracks (device switch, camera toggle). */
  setLocalStream(stream: MediaStream | null): void
  /** Start/stop presenting a screen. */
  setScreenStream(stream: MediaStream | null): void
  /** Push a presence change (name / mute / camera / hand / sharing). */
  updateIdentity(identity: PeerInfo): void
  admit(id: string): void
  deny(id: string): void
  setLobbyOpen(open: boolean): void
  kick(id: string): void
  /** Host: ask everyone else to mute their mic. */
  muteAll(): void
  /** Host: ask a participant to lower their raised hand. */
  lowerHand(id: string): void
  /** Host: hand the host role to another participant. */
  makeHost(id: string): void
  end(): void
  /** Send plugin data on a topic — to the whole room or one peer. E2EE, never via server. */
  sendData(topic: string, payload: unknown, opts?: { to?: string }): void
}
