import type { ClientMessage, PeerInfo, ServerMessage } from './protocol'
import type { RemotePeer, Transport, TransportHandlers } from './Transport'

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
 * ⚠️ **Not end-to-end encrypted yet.** The SFU forwards plain SRTP it *can* read — the honest
 * indicator is `hop-by-hop`, not E2EE. Insertable-Streams frame encryption (the built
 * `FrameCryptor` + `E2eeSession`) is the next step that makes this path E2EE. Data plugins
 * (chat, reactions) and screen-share are follow-ups too: the SFU forwards no data channels and
 * one video track per peer today.
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
  private identity: PeerInfo
  private closed = false
  private leaving = false
  private terminated = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

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
        this.handlers.onConnected(true)
        this.handlers.onPhase('admitted')
        this.handlers.onHost(msg.isHost)
        this.handlers.onLobbyOpen(msg.lobbyOpen)
        for (const peer of msg.peers) this.addPeer(peer)
        // We're in — bring media up against the SFU.
        this.startSfu()
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
        this.handlers.onHost(msg.isHost)
        break

      case 'peer-joined':
        this.addPeer(msg.peer)
        this.logActivity('joined', msg.peer.name)
        break
      case 'peer-left': {
        const name = this.peers.get(msg.id)?.name
        this.dropPeer(msg.id)
        if (name) this.logActivity('left', name)
        break
      }
      case 'peer-state':
        this.mergePeer(msg.peer)
        break

      // Media is the SFU's job here — the DO's peer-to-peer relay is mesh-only.
      case 'signal':
      case 'screen-signal':
        break
    }
  }

  // ── SFU media ───────────────────────────────────────────────────────────────────

  private startSfu(): void {
    if (this.sfuStarted) return
    this.sfuStarted = true

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.pc = pc

    // Publish our tracks under the one stream (shared msid). Adding them before the SFU's
    // first offer means the answer already advertises us — we start sending on round one.
    for (const track of this.localStream?.getTracks() ?? []) {
      this.publishStream.addTrack(track)
      pc.addTrack(track, this.publishStream)
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendToSfu({ event: 'candidate', data: JSON.stringify(e.candidate) })
    }
    pc.ontrack = (e) => this.onSfuTrack(e)
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce()
    }

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
      this.sfuStarted = false
      this.pc?.close()
      this.pc = null
      this.sfuWs = null
      setTimeout(() => {
        if (!this.leaving && !this.terminated && !this.closed) this.startSfu()
      }, 1000)
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
    if (!pc) return
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

  end(): void {
    this.sendToServer({ type: 'end' })
  }

  /**
   * Plugin data (chat, reactions) has no path over the SFU yet — it forwards no data channels,
   * and routing via the DO would make it server-visible. A no-op until the E2EE data path
   * lands (Insertable Streams / MLS over the SFU).
   */
  sendData(_topic: string, _payload: unknown, _opts?: { to?: string }): void {
    // Deferred — see the class note.
  }

  leave(): void {
    this.leaving = true
    this.closed = true
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
