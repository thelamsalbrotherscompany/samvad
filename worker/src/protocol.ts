/**
 * The signalling protocol between a browser and its room's Durable Object.
 *
 * The server relays; it never interprets media. SDP and ICE ride through as opaque
 * `data`. On top of relaying, the DO runs a lobby: the first person in is the host, and
 * everyone after knocks and waits for the host to admit them. This same file is mirrored
 * into the web client (web/src/core/transport/protocol.ts).
 */

export type PeerInfo = {
  id: string
  name: string
  muted: boolean
  cameraOff: boolean
  handRaised: boolean
  // Presenting a screen. Presence, like handRaised — it tells viewers to expect (and,
  // when it flips off, to tear down) a screen connection from this person.
  sharing: boolean
}

export type SignalKind = 'offer' | 'answer' | 'ice'

/** Browser → Durable Object. */
export type ClientMessage =
  // `create` is true only for "New meeting". Joining a code/link sends false, so an
  // empty (non-existent) room is rejected instead of silently springing into being.
  | {
      type: 'join'
      name: string
      muted: boolean
      cameraOff: boolean
      handRaised: boolean
      sharing: boolean
      create: boolean
      // Per-tab id. A reconnect (drop/refresh) reuses it to reclaim the same spot.
      session: string
    }
  // Deliberate departure — distinguishes "I left" from "I dropped" (no grace hold).
  | { type: 'leave' }
  | { type: 'state'; muted: boolean; cameraOff: boolean; handRaised: boolean; sharing: boolean }
  | { type: 'signal'; to: string; kind: SignalKind; data: unknown }
  // Screen-share handshake — a separate PC per presenter, so it never disturbs the
  // camera/mic connection. `presenter` is whose screen this is (always the offerer),
  // which lets a peer that is both presenting and viewing keep the two PCs apart.
  | { type: 'screen-signal'; to: string; presenter: string; kind: SignalKind; data: unknown }
  // Opaque topic-addressed data, broadcast (no `to`) or unicast. The SFU path uses it as
  // the MLS **delivery service** — safe because MLS treats the relay as untrusted: the DO
  // can see handshake bytes but can never derive the media keys. Mesh doesn't use this (its
  // data rides the P2P channel). `payload` is never interpreted by the server.
  | { type: 'data'; to?: string; topic: string; payload: unknown }
  | { type: 'admit'; id: string } // host only
  | { type: 'deny'; id: string } // host only
  | { type: 'set-lobby'; open: boolean } // host only: open = anyone with the link joins
  | { type: 'kick'; id: string } // host only
  | { type: 'mute-all' } // host only: ask every other admitted participant to mute their mic
  | { type: 'lower-hand'; id: string } // host only: ask a participant to lower their raised hand
  | { type: 'make-host'; id: string } // host only: hand the host role to another participant
  // Host only: the room-wide stage. `spotlightId` features one person on everyone's stage (the
  // presenter; null = follow the active speaker); `classroom` asks non-presenters to go
  // audio-first (camera off) — a request each client honours, never a server touching hardware.
  | { type: 'stage'; spotlightId: string | null; classroom: boolean }
  | { type: 'end' } // host only: close the room for everyone

/** Durable Object → browser. */
export type ServerMessage =
  // You're in. Sent to the host immediately, and to a guest once admitted. `lobbyOpen`
  // reflects the room's current admission policy; `spotlightId`/`classroom` hand a late
  // joiner the room's current stage state so they land on the presenter, not a blank grid.
  | {
      type: 'welcome'
      selfId: string
      isHost: boolean
      lobbyOpen: boolean
      spotlightId: string | null
      classroom: boolean
      peers: PeerInfo[]
    }
  // You're in the lobby; the host has been asked.
  | { type: 'waiting' }
  // The host declined; your socket will close.
  | { type: 'denied' }
  // The host removed you from the call; your socket will close.
  | { type: 'kicked' }
  // The host asked everyone to mute — the client mutes its own mic (a request it honours,
  // never a server reaching into your hardware).
  | { type: 'force-mute' }
  // The host cleared your raised hand (e.g. after calling on you) — lower it locally.
  | { type: 'force-lower' }
  // The host ended the meeting for everyone; your socket will close.
  | { type: 'ended' }
  // You tried to join a room that doesn't exist (no one has created it); socket closes.
  | { type: 'not-found' }
  // The admission policy changed (host's toggle reflects this).
  | { type: 'lobby'; open: boolean }
  // To the host: someone is knocking.
  | { type: 'knock'; peer: PeerInfo }
  // To the host: a knocker gave up before you decided.
  | { type: 'knock-cancelled'; id: string }
  // Your host status changed (e.g. the host left and you're now it).
  | { type: 'role'; isHost: boolean }
  // The room-wide stage changed (see the client `stage`) — every client honours it: the
  // presenter takes the featured slot, and non-presenters go audio-first under `classroom`.
  | { type: 'stage'; spotlightId: string | null; classroom: boolean }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; id: string }
  | { type: 'peer-state'; peer: PeerInfo }
  | { type: 'signal'; from: string; kind: SignalKind; data: unknown }
  // Relayed screen-share handshake (see the client `screen-signal`).
  | { type: 'screen-signal'; from: string; presenter: string; kind: SignalKind; data: unknown }
  // Relayed topic-addressed data (see the client `data`) — the MLS delivery service.
  | { type: 'data'; from: string; topic: string; payload: unknown }
