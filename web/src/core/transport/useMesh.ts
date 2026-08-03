import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MeshTransport,
  type ActivityEvent,
  type ChatMessage,
  type Phase,
  type RemotePeer,
} from './MeshTransport'

/** A handler for messages arriving on a plugin data topic. */
export type DataHandler = (payload: unknown, from: string) => void
import type { PeerInfo } from './protocol'

type Options = {
  /** Connect when true (i.e. the user has joined the call). */
  enabled: boolean
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
  messages: ChatMessage[]
  activity: ActivityEvent[]
  admit: (id: string) => void
  deny: (id: string) => void
  setLobbyOpen: (open: boolean) => void
  kick: (id: string) => void
  end: () => void
  sendChat: (text: string) => void
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
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const ref = useRef<MeshTransport | null>(null)
  // Plugin topic subscribers, kept in a ref so the transport's onData handler (set once at
  // construction) always dispatches to the current set.
  const subscribersRef = useRef(new Map<string, Set<DataHandler>>())

  useEffect(() => {
    if (!opts.enabled) return

    const transport = new MeshTransport(
      opts.roomName,
      {
        id: '',
        name: opts.name,
        muted: opts.muted,
        cameraOff: opts.cameraOff,
        handRaised: opts.handRaised,
        sharing: opts.screenStream != null,
      },
      opts.localStream,
      opts.create,
      opts.session,
      {
        onPeers: setPeers,
        onConnected: setConnected,
        onPhase: setPhase,
        onHost: setIsHost,
        onKnocks: setKnocks,
        onLobbyOpen: setLobbyOpenState,
        onChat: (m) => setMessages((prev) => [...prev, m]),
        onData: (topic, from, payload) => {
          subscribersRef.current.get(topic)?.forEach((h) => h(payload, from))
        },
        onActivity: (e) => setActivity((prev) => [...prev, e]),
      },
    )
    transport.connect()
    ref.current = transport

    return () => {
      transport.leave()
      ref.current = null
      setPeers([])
      setKnocks([])
      setMessages([])
      setActivity([])
      setConnected(false)
      setPhase('connecting')
      setIsHost(false)
      setLobbyOpenState(false)
    }
    // Identity/stream are pushed via their own effects — not deps here, so muting
    // doesn't tear down the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.roomName])

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
  const sendChat = useCallback((text: string) => ref.current?.sendChat(text), [])
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
    messages,
    activity,
    admit,
    deny,
    setLobbyOpen,
    kick,
    end,
    sendChat,
    sendData,
    subscribeData,
  }
}
