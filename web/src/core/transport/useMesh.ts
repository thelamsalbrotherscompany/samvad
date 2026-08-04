import { useCallback, useEffect, useRef, useState } from 'react'
import { MeshTransport } from './MeshTransport'
import { PionTransport } from './PionTransport'
import type { ActivityEvent, Phase, RemotePeer, Transport } from './Transport'
import type { PeerInfo } from './protocol'

/** A handler for messages arriving on a plugin data topic. */
export type DataHandler = (payload: unknown, from: string) => void

/** Which media transport backs the call. UI never branches on this — only useMesh does. */
export type TransportKind = 'mesh' | 'sfu'

type Options = {
  /** Connect when true (i.e. the user has joined the call). */
  enabled: boolean
  /** Media path: P2P mesh (default) or the self-hosted Pion SFU. Presence is identical. */
  transport: TransportKind
  roomName: string
  /** True only for "New meeting" — permits creating this room if it doesn't exist. */
  create: boolean
  /** Per-tab id used to reclaim our spot on reconnect (see RoomDO grace window). */
  session: string
  localStream: MediaStream | null
  /** The screen we're presenting, or null. Published on its own connection per viewer. */
  screenStream: MediaStream | null
  name: string
  muted: boolean
  cameraOff: boolean
  handRaised: boolean
}

export type Mesh = {
  connected: boolean
  phase: Phase
  isHost: boolean
  lobbyOpen: boolean
  peers: RemotePeer[]
  knocks: PeerInfo[]
  activity: ActivityEvent[]
  admit: (id: string) => void
  deny: (id: string) => void
  setLobbyOpen: (open: boolean) => void
  kick: (id: string) => void
  end: () => void
  /** Send plugin data on a topic (whole room, or one peer). E2EE, P2P. */
  sendData: (topic: string, payload: unknown, opts?: { to?: string }) => void
  /** Subscribe to a plugin data topic. Returns an unsubscribe fn. */
  subscribeData: (topic: string, handler: DataHandler) => () => void
}

/**
 * React lifecycle around a MeshTransport: connect on join, keep the published stream and
 * presence in sync, and surface the roster plus the lobby state (waiting / admitted /
 * denied, host status, and who's knocking).
 */
export function useMesh(opts: Options): Mesh {
  const [peers, setPeers] = useState<RemotePeer[]>([])
  const [knocks, setKnocks] = useState<PeerInfo[]>([])
  const [connected, setConnected] = useState(false)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [isHost, setIsHost] = useState(false)
  const [lobbyOpen, setLobbyOpenState] = useState(false)
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  // Typed to the interface, not the concrete class: the app is transport-agnostic, so a
  // future RealtimeTransport / PionTransport drops in here with no UI changes.
  const ref = useRef<Transport | null>(null)
  // Plugin topic subscribers, kept in a ref so the transport's onData handler (set once at
  // construction) always dispatches to the current set.
  const subscribersRef = useRef(new Map<string, Set<DataHandler>>())

  useEffect(() => {
    if (!opts.enabled) return

    const identity: PeerInfo = {
      id: '',
      name: opts.name,
      muted: opts.muted,
      cameraOff: opts.cameraOff,
      handRaised: opts.handRaised,
      sharing: opts.screenStream != null,
    }
    const handlers = {
      onPeers: setPeers,
      onConnected: setConnected,
      onPhase: setPhase,
      onHost: setIsHost,
      onKnocks: setKnocks,
      onLobbyOpen: setLobbyOpenState,
      onData: (topic: string, from: string, payload: unknown) => {
        subscribersRef.current.get(topic)?.forEach((h) => h(payload, from))
      },
      onActivity: (e: ActivityEvent) => setActivity((prev) => [...prev, e]),
    }
    // Same constructor shape, so selection is the only line that knows the difference.
    const Ctor = opts.transport === 'sfu' ? PionTransport : MeshTransport
    const transport: Transport = new Ctor(
      opts.roomName,
      identity,
      opts.localStream,
      opts.create,
      opts.session,
      handlers,
    )
    transport.connect()
    ref.current = transport

    return () => {
      transport.leave()
      ref.current = null
      setPeers([])
      setKnocks([])
      setActivity([])
      setConnected(false)
      setPhase('connecting')
      setIsHost(false)
      setLobbyOpenState(false)
    }
    // Identity/stream are pushed via their own effects — not deps here, so muting
    // doesn't tear down the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.roomName, opts.transport])

  useEffect(() => {
    ref.current?.setLocalStream(opts.localStream)
  }, [opts.localStream])

  useEffect(() => {
    ref.current?.setScreenStream(opts.screenStream)
  }, [opts.screenStream])

  useEffect(() => {
    ref.current?.updateIdentity({
      id: '',
      name: opts.name,
      muted: opts.muted,
      cameraOff: opts.cameraOff,
      handRaised: opts.handRaised,
      sharing: opts.screenStream != null,
    })
  }, [opts.name, opts.muted, opts.cameraOff, opts.handRaised, opts.screenStream])

  const admit = useCallback((id: string) => ref.current?.admit(id), [])
  const deny = useCallback((id: string) => ref.current?.deny(id), [])
  const setLobbyOpen = useCallback((open: boolean) => ref.current?.setLobbyOpen(open), [])
  const kick = useCallback((id: string) => ref.current?.kick(id), [])
  const end = useCallback(() => ref.current?.end(), [])
  const sendData = useCallback(
    (topic: string, payload: unknown, opts?: { to?: string }) =>
      ref.current?.sendData(topic, payload, opts),
    [],
  )
  const subscribeData = useCallback((topic: string, handler: DataHandler) => {
    const map = subscribersRef.current
    let set = map.get(topic)
    if (!set) {
      set = new Set()
      map.set(topic, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
      if (set.size === 0) map.delete(topic)
    }
  }, [])

  return {
    connected,
    phase,
    isHost,
    lobbyOpen,
    peers,
    knocks,
    activity,
    admit,
    deny,
    setLobbyOpen,
    kick,
    end,
    sendData,
    subscribeData,
  }
}
