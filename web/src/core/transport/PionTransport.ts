import type { ClientMessage, PeerInfo, ServerMessage } from './protocol'
import type { EncryptionMode, RemotePeer, Transport, TransportHandlers } from './Transport'
import { E2eeSession } from '@/core/crypto/E2eeSession'
import { pipeThrough } from '@/core/crypto/frameCrypto'

/**
 * Self-hosted SFU transport (Phase 6). Media flows through a **single** RTCPeerConnection to
 * the Go + Pion SFU in `selfhost/` — you publish once and the SFU fans your tracks out to
 * everyone, instead of the mesh's N peer connections. This is the sovereignty exit: it needs
 * no Cloudflare, only a Go binary you run yourself.
 *
 * It reuses the **same signalling Durable Object** as {@link MeshTransport} for everything
 * that isn't media — presence, the lobby, host controls, identity — so the whole roster/knock
 * system comes for free. Only the media path differs. The two never fight: the DO relays no
 * media here (its `signal`/`screen-signal` messages are ignored), and the SFU carries no
 * presence.
 *
 * **Correlating SFU media back to a person, with no protocol change:** the SFU has no peer-id
 * on the wire — it groups a publisher's audio+video by their MediaStream id (msid) and
 * preserves it to every subscriber. So we publish all our tracks under one stream and rewrite
 * that msid to our **DO id** in the answer SDP; every subscriber then sees
 * `stream.id === <publisher's DO id>` and maps the media straight onto the roster.
 *
 * **End-to-end encrypted.** Insertable-Streams frame encryption (`FrameCryptor`) keyed by an
 * `E2eeSession` (MLS over the DO data relay) makes the SFU forward ciphertext it can't read —
 * the indicator reads `sfu-e2ee` once the group keys, else honest `hop-by-hop`. **Plugin data**
 * (chat, reactions) rides the same relay, sealed under the group key, so it's E2EE too. Still a
 * follow-up: **screen-share** (the SFU carries one video track per peer today) and simulcast.
 */

const STUN_FALLBACK: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]

/** The SFU signalling envelope (see `selfhost/internal/sfu`). `data` is double-encoded JSON. */
type SfuMessage = { event: 'offer' | 'answer' | 'candidate'; data: string }

export class PionTransport implements Transport {
  // Durable Object socket — presence / lobby / host, exactly like the mesh.
  private ws: WebSocket | null = null
  // SFU socket + the one media connection.
  private sfuWs: WebSocket | null = null
  private pc: RTCPeerConnection | null = null
  private sfuStarted = false
  // We can only publish at connect time (the SFU is the sole offerer, so no adding m-lines
  // later). If we're admitted before the camera is ready — which the host is, admitted
  // instantly with no lobby wait — defer the SFU connection until media arrives.
  private wantSfu = false
  private sfuStartTimer: ReturnType<typeof setTimeout> | null = null
  /** All our published tracks live on this one stream, so they share an msid we can rewrite. */
  private readonly publishStream = new MediaStream()

  private readonly peers = new Map<string, RemotePeer>()
  private readonly knocks = new Map<string, PeerInfo>()
  /** Remote streams that arrived before their roster entry — attached once the peer appears. */
  private readonly pendingStreams = new Map<string, MediaStream>()

  private readonly roomName: string
  private readonly handlers: TransportHandlers
  private readonly create: boolean
  private readonly session: string
  private localStream: MediaStream | null
  private iceServers: RTCIceServer[] = STUN_FALLBACK
  private iceReady: Promise<void> | null = null
  private selfId = ''
  private isHost = false
  private identity: PeerInfo
  private closed = false
  private leaving = false
  private terminated = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // E2EE: MLS group key agreement over the DO data relay, driving per-frame AES-GCM on the
  // SFU connection. `e2eeCapable` is whether the browser's Insertable Streams actually
  // attached (Chromium today); until the group is keyed, frames flow in the clear.
  private e2ee: E2eeSession | null = null
  private e2eeCapable = false
  private readonly dataHandlers = new Map<string, (payload: unknown, from: string) => void>()
  private encryptionTimer: ReturnType<typeof setInterval> | null = null
  private lastEncryption: EncryptionMode | null = null

  constructor(
    roomName: string,
    identity: PeerInfo,
    localStream: MediaStream | null,
    create: boolean,
    session: string,
    handlers: TransportHandlers,
  ) {
    this.roomName = roomName
    this.identity = identity
    this.localStream = localStream
    this.create = create
    this.session = session
    this.handlers = handlers
  }

  connect(): void {
    this.iceReady = this.loadIce()
    this.openSocket()
  }

  private async loadIce(): Promise<void> {
    try {
      const res = await fetch('/ice', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { iceServers?: RTCIceServer[] }
      if (data.iceServers && data.iceServers.length > 0) this.iceServers = data.iceServers
    } catch {
      // Keep the STUN fallback.
    }
  }

  // ── Durable Object signalling (presence / lobby / host) ─────────────────────────

  private openSocket(): void {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${scheme}://${location.host}/ws?room=${encodeURIComponent(this.roomName)}`)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.sendToServer({
        type: 'join',
        name: this.identity.name,
        muted: this.identity.muted,
        cameraOff: this.identity.cameraOff,
        handRaised: this.identity.handRaised,
        sharing: false,
        create: this.create,
        session: this.session,
      })
    }
    ws.onmessage = (e) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(e.data as string) as ServerMessage
      } catch {
        return
      }
      void this.onServerMessage(msg)
    }
    ws.onclose = () => {
      this.handlers.onConnected(false)
      if (this.leaving || this.terminated || this.closed) return
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= 6) return
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 8000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.leaving || this.terminated || this.closed) return
      this.teardownMedia()
      this.peers.clear()
      this.emitPeers()
      this.openSocket()
    }, delay)
  }

  private async onServerMessage(msg: ServerMessage): Promise<void> {
    await this.iceReady
    switch (msg.type) {
      case 'welcome':
        this.selfId = msg.selfId
        this.isHost = msg.isHost
        this.handlers.onConnected(true)
        this.handlers.onPhase('admitted')
        this.handlers.onHost(msg.isHost)
        this.handlers.onLobbyOpen(msg.lobbyOpen)
        this.handlers.onStage(this.toLocalSpotlight(msg.spotlightId), msg.classroom)
        for (const peer of msg.peers) this.addPeer(peer)
        // We're in — bring media (and its E2EE) up against the SFU, once the camera is ready.
        this.wantSfu = true
        this.maybeStartSfu()
        break

      case 'waiting':
        this.handlers.onConnected(true)
        this.handlers.onPhase('waiting')
        break

      case 'denied':
        this.terminated = true
        this.handlers.onPhase('denied')
        break
      case 'kicked':
        this.terminated = true
        this.handlers.onPhase('removed')
        break

      case 'force-mute':
        this.handlers.onForceMute()
        break

      case 'force-lower':
        this.handlers.onForceLower()
        break
      case 'ended':
        this.terminated = true
        this.handlers.onPhase('ended')
        break
      case 'not-found':
        this.terminated = true
        this.handlers.onPhase('not-found')
        break

      case 'lobby':
        this.handlers.onLobbyOpen(msg.open)
        break
      case 'knock':
        this.knocks.set(msg.peer.id, msg.peer)
        this.emitKnocks()
        break
      case 'knock-cancelled':
        this.knocks.delete(msg.id)
        this.emitKnocks()
        break
      case 'role':
        this.isHost = msg.isHost
        this.handlers.onHost(msg.isHost)
        // The committer role follows the host — hand MLS over too.
        this.e2ee?.setHost(msg.isHost)
        break

      case 'stage':
        this.handlers.onStage(this.toLocalSpotlight(msg.spotlightId), msg.classroom)
        break

      case 'peer-joined':
        this.addPeer(msg.peer)
        this.e2ee?.onPeerJoined(msg.peer.id)
        this.logActivity('joined', msg.peer.name)
        break
      case 'peer-left': {
        const name = this.peers.get(msg.id)?.name
        this.dropPeer(msg.id)
        this.e2ee?.onPeerLeft(msg.id)
        if (name) this.logActivity('left', name)
        break
      }
      case 'peer-state':
        this.mergePeer(msg.peer)
        break

      case 'data':
        if (this.dataHandlers.has(msg.topic)) {
          // Internal traffic (the MLS handshake) — its delivery service is this relay.
          this.dataHandlers.get(msg.topic)?.(msg.payload, msg.from)
        } else {
          // Plugin data (chat, reactions) — sealed under the group key; decrypt then dispatch.
          void this.openPluginData(msg.topic, msg.from, msg.payload)
        }
        break

      // Media is the SFU's job here — the DO's peer-to-peer relay is mesh-only.
      case 'signal':
      case 'screen-signal':
        break
    }
  }

  // ── SFU media ───────────────────────────────────────────────────────────────────

  /**
   * Connect to the SFU once we have tracks to publish. If the camera still isn't ready after
   * a short grace, connect anyway (view-only) rather than hang. The SFU is the sole offerer,
   * so whatever we publish here is all we can publish for this connection.
   */
  private maybeStartSfu(): void {
    if (!this.wantSfu || this.sfuStarted) return
    const hasTracks = (this.localStream?.getTracks().length ?? 0) > 0
    if (hasTracks) {
      if (this.sfuStartTimer) {
        clearTimeout(this.sfuStartTimer)
        this.sfuStartTimer = null
      }
      this.startSfu()
    } else if (!this.sfuStartTimer) {
      this.sfuStartTimer = setTimeout(() => {
        this.sfuStartTimer = null
        if (this.wantSfu && !this.sfuStarted) this.startSfu()
      }, 3000)
    }
  }

  private startSfu(): void {
    if (this.sfuStarted) return
    this.sfuStarted = true

    // Insertable Streams lets us encrypt each frame before it reaches the SFU. The flag is
    // Chromium-only; where it's unsupported it's ignored and the path stays honestly
    // hop-by-hop (the frame transforms simply don't attach).
    const config = {
      iceServers: this.iceServers,
      encodedInsertableStreams: true,
    } as RTCConfiguration & { encodedInsertableStreams: boolean }
    const pc = new RTCPeerConnection(config)
    this.pc = pc

    // MLS group key agreement over the DO data relay (its untrusted delivery service),
    // keying the per-frame AES-GCM cipher.
    const e2ee = new E2eeSession(this.selfId, {
      send: (topic, payload, opts) => this.sendToServer({ type: 'data', to: opts?.to, topic, payload }),
      subscribe: (topic, handler) => {
        this.dataHandlers.set(topic, handler)
        return () => this.dataHandlers.delete(topic)
      },
    })
    this.e2ee = e2ee
    this.e2eeCapable = false

    // Publish our tracks under the one stream (shared msid). Adding them before the SFU's
    // first offer means the answer already advertises us — we start sending on round one.
    // Each outgoing frame is encrypted (passthrough until the group is keyed).
    for (const track of this.localStream?.getTracks() ?? []) {
      this.publishStream.addTrack(track)
      const sender = pc.addTrack(track, this.publishStream)
      if (pipeThrough(sender, e2ee.cryptor.encryptStream())) this.e2eeCapable = true
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendToSfu({ event: 'candidate', data: JSON.stringify(e.candidate) })
    }
    pc.ontrack = (e) => {
      // Decrypt incoming frames (a no-op passthrough until we hold the group key).
      pipeThrough(e.receiver, e2ee.cryptor.decryptStream())
      this.onSfuTrack(e)
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce()
    }

    // Drive the handshake, and start reporting the honest mode as it flips clear → encrypted.
    void e2ee.start(this.isHost)
    this.startEncryptionWatch()

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${scheme}://${location.host}/sfu?room=${encodeURIComponent(this.roomName)}`)
    this.sfuWs = ws
    ws.onmessage = (e) => {
      let msg: SfuMessage
      try {
        msg = JSON.parse(e.data as string) as SfuMessage
      } catch {
        return
      }
      void this.onSfuMessage(msg)
    }
    ws.onclose = () => {
      // Reopen the media leg on an unexpected drop; the DO leg drives everything else.
      if (this.leaving || this.terminated || this.closed) return
      this.teardownMedia()
      setTimeout(() => {
        if (!this.leaving && !this.terminated && !this.closed) this.startSfu()
      }, 1000)
    }
  }

  private startEncryptionWatch(): void {
    if (this.encryptionTimer) return
    this.encryptionTimer = setInterval(() => this.emitEncryption(), 500)
    this.emitEncryption()
  }

  /**
   * Report the REAL media encryption (Claude.md §6). Claim `sfu-e2ee` only when frames are
   * actually being encrypted — the browser attached the Insertable-Streams transforms AND the
   * MLS group has produced a key. Anything else is honestly `hop-by-hop`.
   */
  private emitEncryption(): void {
    const mode: EncryptionMode = this.e2eeCapable && this.e2ee?.cryptor.ready ? 'sfu-e2ee' : 'hop-by-hop'
    if (mode !== this.lastEncryption) {
      this.lastEncryption = mode
      this.handlers.onEncryption(mode)
    }
  }

  private async onSfuMessage(msg: SfuMessage): Promise<void> {
    const pc = this.pc
    if (!pc) return
    if (msg.event === 'offer') {
      // The SFU is the sole offerer; we only ever answer (this also covers renegotiation
      // when someone joins/leaves/publishes).
      await pc.setRemoteDescription(JSON.parse(msg.data) as RTCSessionDescriptionInit)
      const answer = await pc.createAnswer()
      // Rewrite our msid to our DO id so subscribers can map our media onto the roster.
      if (answer.sdp && this.selfId) {
        answer.sdp = answer.sdp.split(this.publishStream.id).join(this.selfId)
      }
      await pc.setLocalDescription(answer)
      this.sendToSfu({ event: 'answer', data: JSON.stringify(answer) })
    } else if (msg.event === 'candidate') {
      try {
        await pc.addIceCandidate(JSON.parse(msg.data) as RTCIceCandidateInit)
      } catch {
        // A candidate can arrive before the remote description — harmless.
      }
    }
  }

  private onSfuTrack(e: RTCTrackEvent): void {
    const stream = e.streams[0]
    if (!stream) return
    // stream.id is the publisher's DO id (we rewrote every publisher's msid to theirs).
    const peer = this.peers.get(stream.id)
    if (peer) {
      peer.stream = stream
      this.emitPeers()
    } else {
      // Media beat the roster entry — attach it when the peer arrives.
      this.pendingStreams.set(stream.id, stream)
    }
  }

  private teardownMedia(): void {
    this.sfuStarted = false
    if (this.sfuStartTimer) {
      clearTimeout(this.sfuStartTimer)
      this.sfuStartTimer = null
    }
    if (this.encryptionTimer) {
      clearInterval(this.encryptionTimer)
      this.encryptionTimer = null
    }
    this.e2ee?.stop()
    this.e2ee = null
    this.e2eeCapable = false
    this.dataHandlers.clear()
    if (this.lastEncryption !== null) {
      this.lastEncryption = 'hop-by-hop'
      this.handlers.onEncryption('hop-by-hop')
    }
    this.sfuWs?.close()
    this.sfuWs = null
    this.pc?.close()
    this.pc = null
    for (const t of this.publishStream.getTracks()) this.publishStream.removeTrack(t)
    this.pendingStreams.clear()
  }

  // ── Transport surface ─────────────────────────────────────────────────────────

  /** Swap published tracks without renegotiating (device switch, effect toggle, camera on/off). */
  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream
    const pc = this.pc
    if (!pc) {
      // Not connected yet — the camera may have just become ready, so try to start now.
      this.maybeStartSfu()
      return
    }
    const senders = pc.getSenders()
    for (const track of stream?.getTracks() ?? []) {
      const sender = senders.find((s) => s.track?.kind === track.kind)
      if (sender) void sender.replaceTrack(track)
      // No matching sender means the track kind wasn't published at join. The SFU is the
      // sole offerer, so we can't add a new m-line now — publish with the camera present.
    }
  }

  /** Screen-share over the SFU (a 2nd published track) is a follow-up — no-op for now. */
  setScreenStream(_stream: MediaStream | null): void {
    // Deferred: the SFU forwards one video track per peer today.
  }

  updateIdentity(identity: PeerInfo): void {
    this.identity = identity
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendToServer({
        type: 'state',
        muted: identity.muted,
        cameraOff: identity.cameraOff,
        handRaised: identity.handRaised,
        sharing: false,
      })
    }
  }

  admit(id: string): void {
    this.knocks.delete(id)
    this.emitKnocks()
    this.sendToServer({ type: 'admit', id })
  }

  deny(id: string): void {
    this.knocks.delete(id)
    this.emitKnocks()
    this.sendToServer({ type: 'deny', id })
  }

  setLobbyOpen(open: boolean): void {
    this.sendToServer({ type: 'set-lobby', open })
  }

  kick(id: string): void {
    this.sendToServer({ type: 'kick', id })
  }

  muteAll(): void {
    this.sendToServer({ type: 'mute-all' })
  }

  lowerHand(id: string): void {
    this.sendToServer({ type: 'lower-hand', id })
  }

  makeHost(id: string): void {
    this.sendToServer({ type: 'make-host', id })
  }

  /** Host: set the room-wide stage. `'self'` maps to our DO id on the wire (see MeshTransport). */
  setStage(spotlightId: string | null, classroom: boolean): void {
    const wire = spotlightId === 'self' ? this.selfId : spotlightId
    this.sendToServer({ type: 'stage', spotlightId: wire, classroom })
  }

  /** Translate a wire spotlight id into the app's id space (`'self'` when it's us). */
  private toLocalSpotlight(id: string | null): string | null {
    return id && id === this.selfId ? 'self' : id
  }

  end(): void {
    this.sendToServer({ type: 'end' })
  }

  /**
   * Plugin data (chat, reactions) over the SFU: the SFU forwards no data channels, so it rides
   * the DO relay — but **sealed under the MLS group key** first, so the relay forwards ciphertext
   * it can't read (same E2EE as the media). Dropped silently until the group is keyed (a rare
   * early window); the plugin handles its own local echo, exactly as on mesh.
   */
  sendData(topic: string, payload: unknown, opts?: { to?: string }): void {
    const cryptor = this.e2ee?.cryptor
    if (!cryptor) return
    const plain = new TextEncoder().encode(JSON.stringify(payload))
    void cryptor.seal(plain).then((sealed) => {
      if (sealed) this.sendToServer({ type: 'data', to: opts?.to, topic, payload: sealed })
    })
  }

  /** Decrypt sealed plugin data from a peer and dispatch it to the plugins (via onData). */
  private async openPluginData(topic: string, from: string, payload: unknown): Promise<void> {
    const cryptor = this.e2ee?.cryptor
    if (!cryptor || !Array.isArray(payload)) return
    const plain = await cryptor.open(payload as number[])
    if (!plain) return
    try {
      this.handlers.onData(topic, from, JSON.parse(new TextDecoder().decode(plain)))
    } catch {
      // Malformed after decrypt — ignore.
    }
  }

  leave(): void {
    this.leaving = true
    this.closed = true
    this.wantSfu = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.sendToServer({ type: 'leave' })
    this.teardownMedia()
    this.peers.clear()
    this.ws?.close()
    this.ws = null
  }

  // ── roster ──────────────────────────────────────────────────────────────────────

  private addPeer(info: PeerInfo): void {
    if (this.peers.has(info.id)) return
    const pending = this.pendingStreams.get(info.id) ?? null
    this.pendingStreams.delete(info.id)
    this.peers.set(info.id, { ...info, stream: pending, screenStream: null })
    this.emitPeers()
  }

  private mergePeer(info: PeerInfo): void {
    const prev = this.peers.get(info.id)
    this.peers.set(info.id, {
      ...info,
      stream: prev?.stream ?? this.pendingStreams.get(info.id) ?? null,
      screenStream: prev?.screenStream ?? null,
    })
    this.pendingStreams.delete(info.id)
    this.emitPeers()
  }

  private dropPeer(id: string): void {
    this.peers.delete(id)
    this.pendingStreams.delete(id)
    this.emitPeers()
  }

  private emitPeers(): void {
    if (this.closed) return
    this.handlers.onPeers([...this.peers.values()])
  }

  private emitKnocks(): void {
    if (this.closed) return
    this.handlers.onKnocks([...this.knocks.values()])
  }

  private logActivity(kind: 'joined' | 'left', name: string): void {
    if (this.closed) return
    this.handlers.onActivity({ id: crypto.randomUUID(), kind, name, ts: Date.now() })
  }

  private sendToServer(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private sendToSfu(msg: SfuMessage): void {
    if (this.sfuWs?.readyState === WebSocket.OPEN) this.sfuWs.send(JSON.stringify(msg))
  }
}
