import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MeshTransport,
  type ChatMessage,
  type Phase,
  type Reaction,
  type RemotePeer,
} from './MeshTransport'
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
  reactions: Reaction[]
  admit: (id: string) => void
  deny: (id: string) => void
  setLobbyOpen: (open: boolean) => void
  kick: (id: string) => void
  end: () => void
  sendChat: (text: string) => void
  sendReaction: (emoji: string) => void
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
  const [reactions, setReactions] = useState<Reaction[]>([])
  const ref = useRef<MeshTransport | null>(null)

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
        onReaction: (r) => {
          setReactions((prev) => [...prev, r])
          // Transient — drop it once it has risen and faded (matches the tile animation).
          setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== r.id)), 2800)
        },
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
      setReactions([])
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
  const sendReaction = useCallback((emoji: string) => ref.current?.sendReaction(emoji), [])

  return {
    connected,
    phase,
    isHost,
    lobbyOpen,
    peers,
    knocks,
    messages,
    reactions,
    admit,
    deny,
    setLobbyOpen,
    kick,
    end,
    sendChat,
    sendReaction,
  }
}
