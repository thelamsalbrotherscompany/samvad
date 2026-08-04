import type { ClientMessage, PeerInfo, ServerMessage } from './protocol'

type Status = 'connected' | 'pending' | 'admitted'

type Attachment = PeerInfo & {
  status: Status
  admittedAt: number
  lobbyOpen: boolean
  // Room-wide stage state — meaningful only on the host's attachment (like lobbyOpen), read
  // via {@link RoomDO.currentStage}. Stored on the attachment (not instance memory) so it
  // survives hibernation, and carried forward on host handoff/reclaim.
  spotlightId: string | null
  classroom: boolean
  session: string
  /** Set on a deliberate leave, so the close handler doesn't hold a grace spot. */
  departed: boolean
}

/** A held spot for a participant who dropped — reclaimable for a short window. */
type Grace = PeerInfo & {
  admittedAt: number
  lobbyOpen: boolean
  // Preserve a host's stage across a brief drop, so a reclaim restores classroom/spotlight.
  spotlightId: string | null
  classroom: boolean
  expiresAt: number
}

// How long a dropped participant can reconnect and reclaim their exact spot (and host
// role). Kept in RAM only — best-effort, and forgotten if the room itself is evicted.
const GRACE_MS = 30_000

/**
 * One instance per room, in RAM only. Runs a lobby (first person is host; others knock),
 * and a reconnection grace window: a drop or refresh can rejoin as the same person —
 * reclaiming the host role — within {@link GRACE_MS}, without re-knocking. A *deliberate*
 * leave gets no grace. State is re-derived from live sockets, so hibernation is safe;
 * the grace map is the one piece of instance memory, and it's explicitly best-effort.
 */
export class RoomDO {
  private readonly ctx: DurableObjectState
  private readonly graces = new Map<string, Grace>()

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)

    const attachment: Attachment = {
      id: crypto.randomUUID().slice(0, 8),
      name: '',
      muted: false,
      cameraOff: false,
      handRaised: false,
      sharing: false,
      status: 'connected',
      admittedAt: 0,
      lobbyOpen: false,
      spotlightId: null,
      classroom: false,
      session: '',
      departed: false,
    }
    server.serializeAttachment(attachment)

    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== 'string') return
    const self = this.attachmentOf(ws)
    if (!self) return

    let msg: ClientMessage
    try {
      msg = JSON.parse(raw) as ClientMessage
    } catch {
      return
    }

    switch (msg.type) {
      case 'join': {
        self.name = msg.name
        self.muted = msg.muted
        self.cameraOff = msg.cameraOff
        self.handRaised = msg.handRaised
        self.sharing = msg.sharing
        self.session = msg.session

        this.pruneGraces()
        const grace = this.graces.get(msg.session)
        if (grace) {
          this.reclaim(ws, self, grace)
          break
        }

        const host = this.hostSocket()
        if (!host) {
          if (!msg.create) {
            this.send(ws, { type: 'not-found' })
            ws.close(1000, 'not-found')
            return
          }
          this.admit(ws, self)
          this.send(ws, {
            type: 'welcome',
            selfId: self.id,
            isHost: true,
            lobbyOpen: self.lobbyOpen,
            spotlightId: self.spotlightId,
            classroom: self.classroom,
            peers: [],
          })
        } else if (this.attachmentOf(host)?.lobbyOpen) {
          this.admitAndAnnounce(ws, self)
        } else {
          self.status = 'pending'
          ws.serializeAttachment(self)
          this.send(ws, { type: 'waiting' })
          this.send(host, { type: 'knock', peer: publicInfo(self) })
        }
        break
      }

      case 'leave': {
        self.departed = true
        ws.serializeAttachment(self)
        if (self.status === 'admitted') this.announceLeft(ws, self)
        else if (self.status === 'pending') this.cancelKnock(self)
        ws.close(1000, 'left')
        break
      }

      case 'admit': {
        if (ws !== this.hostSocket()) return
        const target = this.socketById(msg.id)
        const ta = target ? this.attachmentOf(target) : null
        if (target && ta && ta.status === 'pending') this.admitAndAnnounce(target, ta)
        break
      }

      case 'deny': {
        if (ws !== this.hostSocket()) return
        const target = this.socketById(msg.id)
        if (target) {
          this.send(target, { type: 'denied' })
          target.close(1000, 'denied')
        }
        break
      }

      case 'set-lobby': {
        if (ws !== this.hostSocket()) return
        self.lobbyOpen = msg.open
        ws.serializeAttachment(self)
        this.send(ws, { type: 'lobby', open: msg.open })
        if (msg.open) {
          for (const pending of this.pendingSockets()) {
            const pa = this.attachmentOf(pending)
            if (pa) this.admitAndAnnounce(pending, pa)
          }
        }
        break
      }

      case 'kick': {
        if (ws !== this.hostSocket()) return
        const target = this.socketById(msg.id)
        const ta = target ? this.attachmentOf(target) : null
        if (target && target !== ws && ta?.status === 'admitted') {
          this.send(target, { type: 'kicked' })
          target.close(1000, 'kicked')
        }
        break
      }

      case 'mute-all': {
        if (ws !== this.hostSocket()) return
        // A request every other client honours by muting its own mic — the server never
        // touches anyone's hardware.
        this.broadcastAdmitted(ws, { type: 'force-mute' })
        break
      }

      case 'lower-hand': {
        if (ws !== this.hostSocket()) return
        const target = this.socketById(msg.id)
        const ta = target ? this.attachmentOf(target) : null
        if (target && ta?.status === 'admitted') this.send(target, { type: 'force-lower' })
        break
      }

      case 'make-host': {
        if (ws !== this.hostSocket()) return
        const target = this.socketById(msg.id)
        const ta = target ? this.attachmentOf(target) : null
        if (!target || !ta || target === ws || ta.status !== 'admitted') return
        // Host is the earliest-admitted socket; make the target earliest so it becomes host.
        let earliest = Date.now()
        for (const s of this.admittedSockets()) {
          const a = this.attachmentOf(s)
          if (a) earliest = Math.min(earliest, a.admittedAt)
        }
        ta.admittedAt = earliest - 1
        // The room-wide stage lives on the host's attachment — hand it over with the role, so
        // a deliberate handoff doesn't silently drop classroom mode or the spotlight.
        ta.spotlightId = self.spotlightId
        ta.classroom = self.classroom
        self.spotlightId = null
        self.classroom = false
        ws.serializeAttachment(self)
        target.serializeAttachment(ta)
        this.send(target, { type: 'role', isHost: true })
        this.send(ws, { type: 'role', isHost: false })
        break
      }

      case 'stage': {
        if (ws !== this.hostSocket()) return
        // Only spotlight someone actually in the room (or clear it); a stale id would strand
        // every client on a presenter who isn't there.
        const target = msg.spotlightId ? this.socketById(msg.spotlightId) : null
        const valid = !msg.spotlightId || this.attachmentOf(target ?? undefined)?.status === 'admitted'
        self.spotlightId = valid ? msg.spotlightId : null
        self.classroom = msg.classroom
        ws.serializeAttachment(self)
        const out: ServerMessage = {
          type: 'stage',
          spotlightId: self.spotlightId,
          classroom: self.classroom,
        }
        this.send(ws, out)
        this.broadcastAdmitted(ws, out)
        break
      }

      case 'end': {
        if (ws !== this.hostSocket()) return
        for (const other of this.sockets()) {
          if (other === ws) continue
          this.send(other, { type: 'ended' })
          other.close(1000, 'ended')
        }
        break
      }

      case 'state': {
        if (self.status !== 'admitted') return
        self.muted = msg.muted
        self.cameraOff = msg.cameraOff
        self.handRaised = msg.handRaised
        self.sharing = msg.sharing
        ws.serializeAttachment(self)
        this.broadcastAdmitted(ws, { type: 'peer-state', peer: publicInfo(self) })
        break
      }

      case 'signal': {
        if (self.status !== 'admitted') return
        const target = this.socketById(msg.to)
        const ta = target ? this.attachmentOf(target) : null
        if (target && ta?.status === 'admitted') {
          this.send(target, { type: 'signal', from: self.id, kind: msg.kind, data: msg.data })
        }
        break
      }

      case 'screen-signal': {
        if (self.status !== 'admitted') return
        const target = this.socketById(msg.to)
        const ta = target ? this.attachmentOf(target) : null
        if (target && ta?.status === 'admitted') {
          this.send(target, {
            type: 'screen-signal',
            from: self.id,
            presenter: msg.presenter,
            kind: msg.kind,
            data: msg.data,
          })
        }
        break
      }

      case 'data': {
        // Opaque relay — the MLS delivery service for the SFU path. Unicast if `to` is set,
        // else broadcast to every other admitted peer. The payload is never interpreted.
        if (self.status !== 'admitted') return
        const out: ServerMessage = { type: 'data', from: self.id, topic: msg.topic, payload: msg.payload }
        if (msg.to) {
          const target = this.socketById(msg.to)
          const ta = target ? this.attachmentOf(target) : null
          if (target && ta?.status === 'admitted') this.send(target, out)
        } else {
          this.broadcastAdmitted(ws, out)
        }
        break
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.onDrop(ws)
  }

  webSocketError(ws: WebSocket): void {
    this.onDrop(ws)
  }

  // ── admission ──────────────────────────────────────────────────────────────

  private admit(ws: WebSocket, self: Attachment): void {
    self.status = 'admitted'
    self.admittedAt = Date.now()
    ws.serializeAttachment(self)
  }

  private admitAndAnnounce(ws: WebSocket, self: Attachment): void {
    this.admit(ws, self)
    const peers = this.roster().filter((p) => p.id !== self.id)
    const stage = this.currentStage()
    this.send(ws, {
      type: 'welcome',
      selfId: self.id,
      isHost: this.hostSocket() === ws,
      lobbyOpen: this.currentLobbyOpen(),
      spotlightId: stage.spotlightId,
      classroom: stage.classroom,
      peers,
    })
    this.broadcastAdmitted(ws, { type: 'peer-joined', peer: publicInfo(self) })
  }

  /** Reconnect within the grace window: take back the same id, join time, and host role. */
  private reclaim(ws: WebSocket, self: Attachment, grace: Grace): void {
    this.graces.delete(self.session)
    const prevHost = this.hostSocket()

    self.id = grace.id
    self.admittedAt = grace.admittedAt
    self.lobbyOpen = grace.lobbyOpen
    // Restore the host's stage (classroom/spotlight) the drop was holding.
    self.spotlightId = grace.spotlightId
    self.classroom = grace.classroom
    self.status = 'admitted'
    ws.serializeAttachment(self)

    const peers = this.roster().filter((p) => p.id !== self.id)
    const isHost = this.hostSocket() === ws
    const stage = this.currentStage()
    this.send(ws, {
      type: 'welcome',
      selfId: self.id,
      isHost,
      lobbyOpen: this.currentLobbyOpen(),
      spotlightId: stage.spotlightId,
      classroom: stage.classroom,
      peers,
    })
    this.broadcastAdmitted(ws, { type: 'peer-joined', peer: publicInfo(self) })

    // Reclaimed the host role from whoever was standing in.
    if (isHost && prevHost && prevHost !== ws) {
      this.send(prevHost, { type: 'role', isHost: false })
    }
  }

  // ── departure ──────────────────────────────────────────────────────────────

  private onDrop(ws: WebSocket): void {
    const self = this.attachmentOf(ws)
    if (!self || self.departed) return // a clean leave already handled it

    if (self.status === 'admitted') {
      if (self.session) {
        this.graces.set(self.session, {
          id: self.id,
          name: self.name,
          muted: self.muted,
          cameraOff: self.cameraOff,
          handRaised: self.handRaised,
          sharing: self.sharing,
          admittedAt: self.admittedAt,
          lobbyOpen: self.lobbyOpen,
          spotlightId: self.spotlightId,
          classroom: self.classroom,
          expiresAt: Date.now() + GRACE_MS,
        })
      }
      this.announceLeft(ws, self)
    } else if (self.status === 'pending') {
      this.cancelKnock(self)
    }
  }

  private announceLeft(ws: WebSocket, self: Attachment): void {
    this.broadcastAdmitted(ws, { type: 'peer-left', id: self.id })
    const host = this.hostSocket(ws)
    if (host && host !== ws) {
      this.send(host, { type: 'role', isHost: true })
      for (const peer of this.pendingPeers()) this.send(host, { type: 'knock', peer })
      // If the host is the one leaving, hand its stage state to the new host, so classroom
      // mode / the spotlight survive the handoff (matches make-host and reclaim).
      if (self.spotlightId != null || self.classroom) {
        const ha = this.attachmentOf(host)
        if (ha) {
          ha.spotlightId = self.spotlightId
          ha.classroom = self.classroom
          host.serializeAttachment(ha)
        }
      }
    }
    // If the person leaving was the spotlighted presenter, clear the spotlight room-wide so no
    // one is left featuring a ghost. (Reads the host *after* any handoff above.)
    this.clearSpotlightIfLeft(self.id, ws)
  }

  /** Clear + broadcast the spotlight if it points at someone who has now left. */
  private clearSpotlightIfLeft(leftId: string, exclude: WebSocket): void {
    const host = this.hostSocket(exclude)
    const ha = this.attachmentOf(host)
    if (!host || !ha || ha.spotlightId !== leftId) return
    ha.spotlightId = null
    host.serializeAttachment(ha)
    const out: ServerMessage = { type: 'stage', spotlightId: null, classroom: ha.classroom }
    this.send(host, out)
    this.broadcastAdmitted(host, out)
  }

  private cancelKnock(self: Attachment): void {
    const host = this.hostSocket()
    if (host) this.send(host, { type: 'knock-cancelled', id: self.id })
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private pruneGraces(): void {
    const now = Date.now()
    for (const [session, grace] of this.graces) {
      if (grace.expiresAt <= now) this.graces.delete(session)
    }
  }

  private currentLobbyOpen(): boolean {
    return !!this.attachmentOf(this.hostSocket())?.lobbyOpen
  }

  /** The room-wide stage, read off the host's attachment (its single source of truth). */
  private currentStage(): { spotlightId: string | null; classroom: boolean } {
    const host = this.attachmentOf(this.hostSocket())
    return { spotlightId: host?.spotlightId ?? null, classroom: host?.classroom ?? false }
  }

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets()
  }

  private attachmentOf(ws: WebSocket | undefined): Attachment | null {
    return ws ? ((ws.deserializeAttachment() as Attachment | null) ?? null) : null
  }

  private admittedSockets(): WebSocket[] {
    return this.sockets().filter((ws) => {
      const a = this.attachmentOf(ws)
      return a?.status === 'admitted' && !a.departed
    })
  }

  private pendingSockets(): WebSocket[] {
    return this.sockets().filter((ws) => this.attachmentOf(ws)?.status === 'pending')
  }

  /** Earliest-admitted participant (tie-broken by id), optionally skipping a leaver. */
  private hostSocket(exclude?: WebSocket): WebSocket | undefined {
    let best: WebSocket | undefined
    let bestAtt: Attachment | undefined
    for (const ws of this.admittedSockets()) {
      if (ws === exclude) continue
      const a = this.attachmentOf(ws)
      if (!a) continue
      if (
        !bestAtt ||
        a.admittedAt < bestAtt.admittedAt ||
        (a.admittedAt === bestAtt.admittedAt && a.id < bestAtt.id)
      ) {
        best = ws
        bestAtt = a
      }
    }
    return best
  }

  private roster(): PeerInfo[] {
    return this.admittedSockets()
      .map((ws) => this.attachmentOf(ws))
      .filter((a): a is Attachment => a !== null)
      .map(publicInfo)
  }

  private pendingPeers(): PeerInfo[] {
    return this.pendingSockets()
      .map((ws) => this.attachmentOf(ws))
      .filter((a): a is Attachment => a !== null)
      .map(publicInfo)
  }

  private socketById(id: string): WebSocket | undefined {
    return this.sockets().find((ws) => this.attachmentOf(ws)?.id === id)
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // Socket may be closing.
    }
  }

  private broadcastAdmitted(except: WebSocket, msg: ServerMessage): void {
    const payload = JSON.stringify(msg)
    for (const ws of this.admittedSockets()) {
      if (ws === except) continue
      try {
        ws.send(payload)
      } catch {
        // Skip a socket mid-close.
      }
    }
  }
}

function publicInfo(a: PeerInfo): PeerInfo {
  return {
    id: a.id,
    name: a.name,
    muted: a.muted,
    cameraOff: a.cameraOff,
    handRaised: a.handRaised,
    sharing: a.sharing,
  }
}
