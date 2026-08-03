import type {
  ClientMessage,
  PeerInfo,
  ServerMessage,
  SignalKind,
} from './protocol'

/**
 * P2P mesh transport. Every participant holds a direct RTCPeerConnection to every
 * other participant, so media never touches a server — this is genuinely E2EE by
 * construction, because no middlebox exists to trust (docs/ARCHITECTURE.md §3).
 *
 * The signalling Durable Object only relays the handshake. To avoid glare, the rule is
 * one-directional: a NEWCOMER offers to everyone already in the room; existing peers
 * only ever answer.
 *
 * Correct up to ~4–5 people (each client uploads N−1 copies of itself); the SfuTransport
 * takes over beyond that, behind this same shape.
 */

export type RemotePeer = PeerInfo & {
  stream: MediaStream | null
  /** This peer's shared screen, on a connection of its own. Null until it's flowing. */
  screenStream: MediaStream | null
}

/**
 * A chat message. Chat rides the P2P data channels — never the signalling server — so it's
 * end-to-end encrypted by construction and no middlebox can read it. Ephemeral: there's no
 * history, so a late joiner sees only messages sent after they arrived.
 */
export type ChatMessage = {
  id: string
  senderId: string
  senderName: string
  text: string
  ts: number
  /** True for messages you sent (shown immediately, not echoed back over the wire). */
  self: boolean
}

/** A transient emoji reaction — floats up and vanishes, never stored. Same E2EE path. */
export type Reaction = {
  id: string
  senderId: string
  senderName: string
  emoji: string
  self: boolean
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

// Fallback until the worker's /ice list loads (or if it can't be reached). The worker
// adds Cloudflare Realtime TURN on top of this when credentials are configured, for the
// ~15% of networks that can't connect directly. stun.cloudflare.com is free and unlimited.
const STUN_FALLBACK: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]

type Handlers = {
  onPeers: (peers: RemotePeer[]) => void
  onConnected: (connected: boolean) => void
  onPhase: (phase: Phase) => void
  onHost: (isHost: boolean) => void
  onKnocks: (knocks: PeerInfo[]) => void
  onLobbyOpen: (open: boolean) => void
  onChat: (msg: ChatMessage) => void
  onReaction: (r: Reaction) => void
}

export class MeshTransport {
  private ws: WebSocket | null = null
  private readonly pcs = new Map<string, RTCPeerConnection>()
  // Screen share rides on its own PCs so it never renegotiates the camera/mic link.
  // outScreen: my screen → each viewer (keyed by viewer). inScreen: each presenter's
  // screen → me (keyed by presenter). Kept apart so I can present and view at once.
  private readonly outScreenPcs = new Map<string, RTCPeerConnection>()
  private readonly inScreenPcs = new Map<string, RTCPeerConnection>()
  // One negotiated data channel per peer for chat — E2EE, never via the server.
  private readonly chatChannels = new Map<string, RTCDataChannel>()
  private readonly peers = new Map<string, RemotePeer>()
  private readonly knocks = new Map<string, PeerInfo>()
  private readonly roomName: string
  private readonly handlers: Handlers
  /** True only for "New meeting" — permits bringing an empty room into existence. */
  private readonly create: boolean
  /** Per-tab id used to reclaim our spot after a drop/refresh (see RoomDO grace). */
  private readonly session: string
  private localStream: MediaStream | null
  private screenStream: MediaStream | null = null
  // ICE servers fetched from the worker (STUN, plus TURN when configured). Every peer
  // connection waits on `iceReady` so the very first one already has any TURN relay.
  private iceServers: RTCIceServer[] = STUN_FALLBACK
  private iceReady: Promise<void> | null = null
  /** Our own id, learned from `welcome`; stamped onto screen signals as the presenter. */
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
    handlers: Handlers,
  ) {
    this.roomName = roomName
    this.identity = identity
    this.localStream = localStream
    this.create = create
    this.session = session
    this.handlers = handlers
  }

  connect(): void {
    // Kick off the ICE fetch in parallel with the socket; PC creation awaits it.
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
      // Keep the STUN fallback — the call still connects on most networks.
    }
  }

  private openSocket(): void {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${scheme}://${location.host}/ws?room=${encodeURIComponent(this.roomName)}`
    const ws = new WebSocket(url)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.sendToServer({
        type: 'join',
        name: this.identity.name,
        muted: this.identity.muted,
        cameraOff: this.identity.cameraOff,
        handRaised: this.identity.handRaised,
        sharing: this.screenStream != null,
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
    // A handful of backoff attempts, roughly matching the server's grace window.
    if (this.reconnectAttempts >= 6) return
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 8000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.leaving || this.terminated || this.closed) return
      // Rebuild media fresh from whatever roster the reconnect welcome hands back.
      this.resetPeers()
      this.openSocket()
    }, delay)
  }

  private resetPeers(): void {
    for (const pc of this.pcs.values()) pc.close()
    this.pcs.clear()
    this.chatChannels.clear()
    for (const pc of this.outScreenPcs.values()) pc.close()
    this.outScreenPcs.clear()
    for (const pc of this.inScreenPcs.values()) pc.close()
    this.inScreenPcs.clear()
    this.peers.clear()
    this.emitPeers()
  }

  /** Replace published tracks without renegotiating (device switch, camera toggle). */
  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream
    for (const pc of this.pcs.values()) {
      const senders = pc.getSenders()
      for (const track of stream?.getTracks() ?? []) {
        const sender = senders.find((s) => s.track?.kind === track.kind)
        if (sender) void sender.replaceTrack(track)
        else if (stream) pc.addTrack(track, stream)
      }
    }
  }

  /** Start presenting a screen (open a PC out to every viewer) or stop (close them). */
  setScreenStream(stream: MediaStream | null): void {
    if (stream === this.screenStream) return
    this.screenStream = stream
    if (stream) {
      for (const peerId of this.peers.keys()) this.ensureOutScreen(peerId)
    } else {
      for (const pc of this.outScreenPcs.values()) pc.close()
      this.outScreenPcs.clear()
    }
  }

  /** Host: let a knocking guest in. */
  admit(id: string): void {
    this.knocks.delete(id)
    this.emitKnocks()
    this.sendToServer({ type: 'admit', id })
  }

  /** Host: turn a knocking guest away. */
  deny(id: string): void {
    this.knocks.delete(id)
    this.emitKnocks()
    this.sendToServer({ type: 'deny', id })
  }

  /** Host: open the room (anyone with the link joins) or close it (approve each guest). */
  setLobbyOpen(open: boolean): void {
    this.sendToServer({ type: 'set-lobby', open })
  }

  /** Host: remove an admitted participant. */
  kick(id: string): void {
    this.sendToServer({ type: 'kick', id })
  }

  /** Host: end the meeting for everyone. */
  end(): void {
    this.sendToServer({ type: 'end' })
  }

  /** Broadcast a chat message to every connected peer — P2P, never via the server. */
  sendChat(text: string): void {
    const body = text.trim()
    if (!body) return
    const ts = Date.now()
    this.broadcastData(JSON.stringify({ t: 'chat', name: this.identity.name, text: body, ts }))
    // Our own message shows immediately; it's never echoed back over the wire.
    this.handlers.onChat({
      id: crypto.randomUUID(),
      senderId: this.selfId,
      senderName: this.identity.name,
      text: body,
      ts,
      self: true,
    })
  }

  /** Broadcast a transient emoji reaction to every connected peer. */
  sendReaction(emoji: string): void {
    if (!emoji) return
    this.broadcastData(JSON.stringify({ t: 'reaction', name: this.identity.name, emoji }))
    this.handlers.onReaction({
      id: crypto.randomUUID(),
      senderId: this.selfId,
      senderName: this.identity.name,
      emoji,
      self: true,
    })
  }

  private broadcastData(payload: string): void {
    for (const ch of this.chatChannels.values()) {
      if (ch.readyState === 'open') {
        try {
          ch.send(payload)
        } catch {
          // Channel mid-close — skip it.
        }
      }
    }
  }

  private onDataMessage(peerId: string, raw: string): void {
    let data: { t?: unknown; name?: unknown; text?: unknown; emoji?: unknown; ts?: unknown }
    try {
      data = JSON.parse(raw) as typeof data
    } catch {
      return
    }
    const peer = this.peers.get(peerId)
    const senderName =
      typeof data.name === 'string' && data.name ? data.name : peer?.name || 'Guest'

    if (data.t === 'reaction' && typeof data.emoji === 'string' && data.emoji) {
      this.handlers.onReaction({
        id: crypto.randomUUID(),
        senderId: peerId,
        senderName,
        emoji: data.emoji,
        self: false,
      })
      return
    }
    if (typeof data.text === 'string' && data.text) {
      this.handlers.onChat({
        id: crypto.randomUUID(),
        senderId: peerId,
        senderName,
        text: data.text,
        ts: typeof data.ts === 'number' ? data.ts : Date.now(),
        self: false,
      })
    }
  }

  /** Push a presence change (mute / camera / hand) to the room. */
  updateIdentity(identity: PeerInfo): void {
    this.identity = identity
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendToServer({
        type: 'state',
        muted: identity.muted,
        cameraOff: identity.cameraOff,
        handRaised: identity.handRaised,
        sharing: identity.sharing,
      })
    }
  }

  leave(): void {
    this.leaving = true
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // Tell the room this is deliberate, so it doesn't hold a grace spot for us.
    this.sendToServer({ type: 'leave' })
    for (const pc of this.pcs.values()) pc.close()
    this.pcs.clear()
    this.chatChannels.clear()
    for (const pc of this.outScreenPcs.values()) pc.close()
    this.outScreenPcs.clear()
    for (const pc of this.inScreenPcs.values()) pc.close()
    this.inScreenPcs.clear()
    this.peers.clear()
    this.ws?.close()
    this.ws = null
  }

  // ── server messages ─────────────────────────────────────────────────────────

  private async onServerMessage(msg: ServerMessage): Promise<void> {
    // Ensure the ICE list (incl. any TURN relay) is loaded before we build a PC. After
    // the first resolve this is a no-op await.
    await this.iceReady
    switch (msg.type) {
      case 'welcome':
        this.selfId = msg.selfId
        this.handlers.onConnected(true)
        this.handlers.onPhase('admitted')
        this.handlers.onHost(msg.isHost)
        this.handlers.onLobbyOpen(msg.lobbyOpen)
        // We're the newcomer: we call everyone already here. If we're mid-presentation
        // (a reconnect while sharing), re-offer our screen to each of them too.
        for (const peer of msg.peers) {
          this.addPeer(peer)
          await this.call(peer.id)
          this.ensureOutScreen(peer.id)
        }
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
        // They'll call us; we just register them and wait for the offer. If we're
        // presenting, open a screen connection out to the newcomer.
        this.addPeer(msg.peer)
        this.ensureOutScreen(msg.peer.id)
        break

      case 'peer-left':
        this.dropPeer(msg.id)
        break

      case 'peer-state': {
        const wasSharing = this.peers.get(msg.peer.id)?.sharing ?? false
        this.mergePeer(msg.peer)
        // They stopped presenting — tear down their screen connection and clear it.
        if (wasSharing && !msg.peer.sharing) this.dropInScreen(msg.peer.id)
        break
      }

      case 'signal':
        await this.onSignal(msg.from, msg.kind, msg.data)
        break

      case 'screen-signal':
        await this.onScreenSignal(msg.from, msg.presenter, msg.kind, msg.data)
        break
    }
  }

  // ── peer connections ─────────────────────────────────────────────────────────

  private ensurePc(peerId: string): RTCPeerConnection {
    const existing = this.pcs.get(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })

    for (const track of this.localStream?.getTracks() ?? []) {
      pc.addTrack(track, this.localStream as MediaStream)
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendToServer({
          type: 'signal',
          to: peerId,
          kind: 'ice',
          data: e.candidate.toJSON(),
        })
      }
    }
    pc.ontrack = (e) => {
      const peer = this.peers.get(peerId)
      if (peer) {
        peer.stream = e.streams[0] ?? new MediaStream([e.track])
        this.emitPeers()
      }
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce()
    }

    // Negotiated data channel for chat: both sides create the same id, so it needs no
    // offer/answer of its own and opens as soon as the connection is up.
    const chat = pc.createDataChannel('samvad-chat', { negotiated: true, id: 0 })
    chat.onmessage = (e) => this.onDataMessage(peerId, e.data as string)
    this.chatChannels.set(peerId, chat)

    this.pcs.set(peerId, pc)
    return pc
  }

  private async call(peerId: string): Promise<void> {
    const pc = this.ensurePc(peerId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.sendToServer({ type: 'signal', to: peerId, kind: 'offer', data: offer })
  }

  private async onSignal(from: string, kind: SignalKind, data: unknown): Promise<void> {
    const pc = this.ensurePc(from)
    if (kind === 'offer') {
      await pc.setRemoteDescription(data as RTCSessionDescriptionInit)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      this.sendToServer({ type: 'signal', to: from, kind: 'answer', data: answer })
    } else if (kind === 'answer') {
      await pc.setRemoteDescription(data as RTCSessionDescriptionInit)
    } else {
      try {
        await pc.addIceCandidate(data as RTCIceCandidateInit)
      } catch {
        // A candidate can arrive before the remote description; browsers buffer, but
        // the odd reject is harmless.
      }
    }
  }

  // ── screen share ────────────────────────────────────────────────────────────────

  /** Open (once) an outgoing screen connection to a viewer, if we're presenting. */
  private ensureOutScreen(peerId: string): void {
    if (!this.screenStream || this.outScreenPcs.has(peerId)) return
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    for (const track of this.screenStream.getTracks()) {
      pc.addTrack(track, this.screenStream)
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendToServer({
          type: 'screen-signal',
          to: peerId,
          presenter: this.selfId,
          kind: 'ice',
          data: e.candidate.toJSON(),
        })
      }
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce()
    }
    this.outScreenPcs.set(peerId, pc)
    void this.offerScreen(peerId, pc)
  }

  private async offerScreen(peerId: string, pc: RTCPeerConnection): Promise<void> {
    await this.tuneScreenSender(pc)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.sendToServer({
      type: 'screen-signal',
      to: peerId,
      presenter: this.selfId,
      kind: 'offer',
      data: offer,
    })
  }

  /**
   * Shape the screen encoder for legibility. A shared screen is mostly static text, so
   * give it a high bitrate ceiling and tell it to shed frame rate — never resolution —
   * under pressure. Without this the default (camera-tuned) encoder downscales the
   * picture, which is exactly what turns shared text into an unreadable, jittery blur.
   */
  private async tuneScreenSender(pc: RTCPeerConnection): Promise<void> {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
    if (!sender) return
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}]
    }
    params.encodings[0].maxBitrate = 5_000_000 // ~5 Mbps — room for full-screen text
    params.encodings[0].scaleResolutionDownBy = 1 // never shrink the picture
    params.degradationPreference = 'maintain-resolution'
    try {
      await sender.setParameters(params)
    } catch {
      // A browser may refuse to reshape encodings mid-stream; the share still works.
    }
  }

  private createInScreen(presenterId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendToServer({
          type: 'screen-signal',
          to: presenterId,
          presenter: presenterId,
          kind: 'ice',
          data: e.candidate.toJSON(),
        })
      }
    }
    pc.ontrack = (e) => {
      const peer = this.peers.get(presenterId)
      if (peer) {
        peer.screenStream = e.streams[0] ?? new MediaStream([e.track])
        this.emitPeers()
      }
    }
    this.inScreenPcs.set(presenterId, pc)
    return pc
  }

  private async onScreenSignal(
    from: string,
    presenter: string,
    kind: SignalKind,
    data: unknown,
  ): Promise<void> {
    // A reply about *our own* screen from a viewer. We only ever offer, so any offer
    // arriving on this branch would be spurious and is ignored.
    if (presenter === this.selfId) {
      const pc = this.outScreenPcs.get(from)
      if (!pc) return
      if (kind === 'answer') {
        await pc.setRemoteDescription(data as RTCSessionDescriptionInit)
      } else if (kind === 'ice') {
        try {
          await pc.addIceCandidate(data as RTCIceCandidateInit)
        } catch {
          // Candidate can precede the answer; harmless.
        }
      }
      return
    }

    // Someone else's screen coming to us (here presenter === from).
    if (kind === 'offer') {
      const pc = this.inScreenPcs.get(from) ?? this.createInScreen(from)
      await pc.setRemoteDescription(data as RTCSessionDescriptionInit)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      this.sendToServer({
        type: 'screen-signal',
        to: from,
        presenter: from,
        kind: 'answer',
        data: answer,
      })
    } else if (kind === 'ice') {
      const pc = this.inScreenPcs.get(from)
      if (!pc) return
      try {
        await pc.addIceCandidate(data as RTCIceCandidateInit)
      } catch {
        // As above.
      }
    }
  }

  /** A presenter stopped (or left): tear down their incoming screen and clear it. */
  private dropInScreen(id: string): void {
    this.inScreenPcs.get(id)?.close()
    this.inScreenPcs.delete(id)
    const peer = this.peers.get(id)
    if (peer?.screenStream) {
      peer.screenStream = null
      this.emitPeers()
    }
  }

  // ── roster ────────────────────────────────────────────────────────────────────

  private addPeer(info: PeerInfo): void {
    if (!this.peers.has(info.id)) {
      this.peers.set(info.id, { ...info, stream: null, screenStream: null })
      this.emitPeers()
    }
  }

  private mergePeer(info: PeerInfo): void {
    const prev = this.peers.get(info.id)
    this.peers.set(info.id, {
      ...info,
      stream: prev?.stream ?? null,
      screenStream: prev?.screenStream ?? null,
    })
    this.emitPeers()
  }

  private dropPeer(id: string): void {
    this.pcs.get(id)?.close()
    this.pcs.delete(id)
    this.chatChannels.delete(id)
    this.outScreenPcs.get(id)?.close()
    this.outScreenPcs.delete(id)
    this.inScreenPcs.get(id)?.close()
    this.inScreenPcs.delete(id)
    this.peers.delete(id)
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

  private sendToServer(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }
}
