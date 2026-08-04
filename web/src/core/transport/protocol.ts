/**
 * Client mirror of the signalling protocol. Kept identical to
 * `worker/src/protocol.ts` — one contract, both ends.
 */

export type PeerInfo = {
  id: string
  name: string
  muted: boolean
  cameraOff: boolean
  handRaised: boolean
  /** Presenting a screen — presence, like handRaised. */
  sharing: boolean
}

export type SignalKind = 'offer' | 'answer' | 'ice'

/** Browser → Durable Object. */
export type ClientMessage =
  | {
      type: 'join'
      name: string
      muted: boolean
      cameraOff: boolean
      handRaised: boolean
      sharing: boolean
      create: boolean
      session: string
    }
  | { type: 'leave' }
  | { type: 'state'; muted: boolean; cameraOff: boolean; handRaised: boolean; sharing: boolean }
  | { type: 'signal'; to: string; kind: SignalKind; data: unknown }
  // Screen-share handshake on a PC of its own; `presenter` is whose screen it carries.
  | { type: 'screen-signal'; to: string; presenter: string; kind: SignalKind; data: unknown }
  // Topic-addressed opaque data relay (broadcast, or unicast with `to`). The SFU path's MLS
  // delivery service; mesh doesn't use it (its data rides the P2P channel).
  | { type: 'data'; to?: string; topic: string; payload: unknown }
  | { type: 'admit'; id: string }
  | { type: 'deny'; id: string }
  | { type: 'set-lobby'; open: boolean }
  | { type: 'kick'; id: string }
  | { type: 'mute-all' } // host only: ask every other admitted participant to mute
  | { type: 'make-host'; id: string } // host only: hand the host role to another participant
  | { type: 'end' }

/** Durable Object → browser. */
export type ServerMessage =
  | { type: 'welcome'; selfId: string; isHost: boolean; lobbyOpen: boolean; peers: PeerInfo[] }
  | { type: 'waiting' }
  | { type: 'denied' }
  | { type: 'kicked' }
  | { type: 'force-mute' } // the host asked everyone to mute; the client mutes its own mic
  | { type: 'ended' }
  | { type: 'not-found' }
  | { type: 'lobby'; open: boolean }
  | { type: 'knock'; peer: PeerInfo }
  | { type: 'knock-cancelled'; id: string }
  | { type: 'role'; isHost: boolean }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; id: string }
  | { type: 'peer-state'; peer: PeerInfo }
  | { type: 'signal'; from: string; kind: SignalKind; data: unknown }
  | { type: 'screen-signal'; from: string; presenter: string; kind: SignalKind; data: unknown }
  | { type: 'data'; from: string; topic: string; payload: unknown }
