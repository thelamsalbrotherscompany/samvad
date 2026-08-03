import { useEffect, useState } from 'react'
import { TooltipProvider } from '@/design/primitives'
import { Stage, resolveStageView, type StageView, type ScreenShare } from '@/features/stage/Stage'
import { TileActionsContext } from '@/features/stage/tileActions'
import { ControlBar } from '@/features/room/ControlBar'
import { RoomChrome } from '@/features/room/RoomChrome'
import { PreJoin } from '@/features/prejoin/PreJoin'
import { WaitingRoom } from '@/features/room/WaitingRoom'
import { SettingsDialog } from '@/features/room/SettingsDialog'
import { ParticipantsPanel } from '@/features/room/ParticipantsPanel'
import { ChatPanel } from '@/features/room/ChatPanel'
import { ShareDialog } from '@/features/room/ShareDialog'
import { Lobby } from '@/features/room/Lobby'
import { KnockRequests } from '@/features/room/KnockRequests'
import { Home } from '@/features/home/Home'
import { LockIcon } from '@/design/icons'
import { TILE_WASHES, type Participant } from '@/core/participants'
import { useLocalMedia } from '@/core/media/useLocalMedia'
import { useActiveSpeaker } from '@/core/media/useActiveSpeaker'
import { useProcessedStream } from '@/core/effects/useProcessedStream'
import { RemoteAudio } from '@/core/media/RemoteAudio'
import { useMesh } from '@/core/transport/useMesh'
import { useRoom } from '@/core/room/useRoom'
import { generateRoomId } from '@/core/room/roomId'
import { getSessionId, getCreatedRoom, setCreatedRoom } from '@/core/room/session'
import { useIdle } from '@/lib/useIdle'
import { useIsNarrow } from '@/lib/useMediaQuery'
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings'
import { cn } from '@/lib/cn'

export default function App() {
  const { roomId, enterRoom, leaveRoom } = useRoom()
  const inRoom = roomId !== ''
  // The one room we're allowed to bring into existence (the id "New meeting" minted).
  // Anything else — a link, a typed code — is a join that must find an existing room.
  // Persisted (sessionStorage), so a host who refreshes keeps the right to recreate it.
  const [createRoomId, setCreateRoomId] = useState<string>(getCreatedRoom)
  const create = inRoom && roomId === createRoomId
  // Stable per-tab id used to reclaim our spot — and host role — after a drop/refresh.
  const [session] = useState(getSessionId)

  // Stop presenting and release the capture (also clears the browser's sharing banner).
  const stopScreenCapture = () => {
    setScreenStream((cur) => {
      cur?.getTracks().forEach((t) => t.stop())
      return null
    })
  }

  // Toggle screen share. Starting prompts the OS/browser picker; the browser's own
  // "Stop sharing" control ends the track, which we mirror back into state.
  const toggleShare = async () => {
    if (screenStream) {
      stopScreenCapture()
      return
    }
    try {
      // Video only for now — routing captured tab/system audio is a later step.
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false,
      })
      const track = s.getVideoTracks()[0]
      // "detail" tells the encoder this is text/UI, not motion — it favours spatial
      // sharpness (readable text) over frame rate. The per-viewer bitrate ceiling and
      // "keep resolution, drop FPS" tuning live in the transport (tuneScreenSender).
      if (track) track.contentHint = 'detail'
      track?.addEventListener('ended', () => {
        setScreenStream((cur) => (cur === s ? null : cur))
      })
      setScreenStream(s)
    } catch {
      // Picker dismissed or capture denied — stay un-shared.
    }
  }

  // Leaving for good: forget the create-intent so returning is a plain join, not a
  // recreate. A refresh never runs this, so the intent survives the reload.
  const goHome = () => {
    stopScreenCapture()
    setCreatedRoom('')
    setCreateRoomId('')
    leaveRoom()
  }

  const [joined, setJoined] = useState(false)
  const media = useLocalMedia(inRoom)
  const muted = !media.micOn
  const cameraOff = !media.cameraOn
  const [handRaised, setHandRaised] = useState(false)
  // Real screen capture (getDisplayMedia). Presenting ⇔ this is non-null.
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const sharing = screenStream !== null
  const [view, setView] = useState<StageView>('auto')
  const [displayName, setDisplayName] = useState('Sangam Lamsal')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  // Real background effect baked into the camera stream — so peers get the blurred
  // background too, not just your local view. Off/unsupported returns the raw stream.
  // This is what everything downstream (self-view, previews, and the mesh) publishes.
  const localStream = useProcessedStream(
    media.stream,
    settings.background,
    settings.backgroundImage,
    media.cameraOn,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatSeen, setChatSeen] = useState(0)
  const [locked, setLocked] = useState(false)

  const patchSettings = (patch: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...patch }))

  const idle = useIdle(3000)
  // Locked = the user chose to keep the chrome hidden; hover no longer reveals it.
  // A minimal unlock pill still surfaces on interaction so they can get back.
  const chromeVisible = !locked && !idle
  const narrow = useIsNarrow()

  // Landing on the home screen (or leaving) ends any active call — and any capture.
  useEffect(() => {
    if (!inRoom) {
      setJoined(false)
      stopScreenCapture()
    }
    // stopScreenCapture uses a functional update, so it needs no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom])

  // Live mesh: connects on join, publishes your camera/mic, returns the remote roster.
  const mesh = useMesh({
    enabled: joined,
    roomName: roomId,
    create,
    session,
    localStream,
    screenStream,
    name: displayName,
    muted,
    cameraOff,
    handRaised,
  })
  const phase = mesh.phase // 'connecting' | 'waiting' | 'admitted' | 'denied'

  // Chat unread: messages that landed while the panel was closed. Open panel ⇒ all seen.
  useEffect(() => {
    if (chatOpen) setChatSeen(mesh.messages.length)
  }, [chatOpen, mesh.messages.length])
  useEffect(() => {
    if (!joined) setChatSeen(0)
  }, [joined])
  const chatUnread = Math.max(0, mesh.messages.length - chatSeen)

  // You, real.
  const selfParticipant: Participant = {
    id: 'self',
    name: displayName,
    isSelf: true,
    muted,
    cameraOff,
    handRaised,
    speaking: false,
    mirrored: settings.mirror,
    stream: localStream,
    wash: 0,
  }

  // Real remote people from the mesh.
  const remoteParticipants: Participant[] = mesh.peers.map((p, i) => ({
    id: p.id,
    name: p.name,
    isSelf: false,
    muted: p.muted,
    cameraOff: p.cameraOff,
    handRaised: p.handRaised,
    speaking: false,
    mirrored: settings.mirrorRemote,
    stream: p.stream,
    wash: (i + 1) % TILE_WASHES.length,
  }))

  const roster = [selfParticipant, ...remoteParticipants]
  const participantCount = roster.length

  // Real voice-activity from live audio: who's talking (rings) + the dominant remote
  // (featured tile). No audio sources until joined.
  const active = useActiveSpeaker(
    joined
      ? [
          { id: selfParticipant.id, stream: media.stream },
          ...mesh.peers.map((p) => ({ id: p.id, stream: p.stream })),
        ]
      : [],
    selfParticipant.id,
  )
  const speakingId = active.dominantId

  // Latest live reaction per participant, so it can pop on their tile (self reactions
  // land on the self tile). Cleared automatically as reactions expire from the mesh.
  const reactionByParticipant = new Map<string, { id: string; emoji: string }>()
  for (const r of mesh.reactions) {
    reactionByParticipant.set(r.self ? 'self' : r.senderId, { id: r.id, emoji: r.emoji })
  }

  const withLiveState = roster.map((p) => ({
    ...p,
    speaking: active.speakingIds.has(p.id) && !p.muted,
    reaction: reactionByParticipant.get(p.id),
  }))

  const self = withLiveState.find((p) => p.isSelf) ?? withLiveState[0]
  const alone = participantCount === 1 && !sharing

  const raisedHands = withLiveState
    .filter((p) => p.handRaised)
    .map((p) => (p.isSelf ? 'You' : p.name))

  // Who's presenting, if anyone: a remote presenter takes the stage over your own
  // (you already know what you're sharing). When *you're* the presenter you get a
  // "presenting" card, never your own live capture — mirroring the capture back onto
  // the captured surface is what creates the infinite feedback tunnel (and it's
  // pointless: it's your screen, right in front of you). Viewers still get the real
  // stream; theirs may lag the `sharing` flag, so the tile placeholders until it lands.
  const remoteSharer = mesh.peers.find((p) => p.sharing)
  const screenShare: ScreenShare | null = remoteSharer
    ? { presenterName: remoteSharer.name, stream: remoteSharer.screenStream }
    : sharing
      ? { presenterName: 'You', stream: null }
      : null

  // The layout actually on screen. The toggle flips this, so pressing it always
  // changes what the user sees — never a hidden preference that already matched.
  const layout = resolveStageView(view, narrow, participantCount, screenShare)

  return (
    <TooltipProvider>
      <div
        className={cn(
          'relative size-full bg-base',
          idle && joined && phase === 'admitted' && 'cursor-none',
        )}
      >
        {!inRoom ? (
          <Home
            onNewMeeting={() => {
              const id = generateRoomId()
              setCreatedRoom(id)
              setCreateRoomId(id)
              enterRoom(id)
            }}
            onJoin={enterRoom}
          />
        ) : !joined ? (
          <PreJoin
            roomName={roomId}
            initialName={displayName}
            settings={settings}
            stream={localStream}
            mediaError={media.error}
            muted={muted}
            cameraOff={cameraOff}
            onToggleMute={() => media.setMicOn(!media.micOn)}
            onToggleCamera={() => media.setCameraOn(!media.cameraOn)}
            onOpenSettings={() => setSettingsOpen(true)}
            onJoin={(name) => {
              setDisplayName(name)
              setJoined(true)
            }}
          />
        ) : phase !== 'admitted' ? (
          <Lobby
            variant={phase}
            roomName={roomId}
            self={self}
            onLeave={() => {
              setJoined(false)
              // Cancelling connecting/waiting drops back to pre-join; every "out" state
              // (denied, removed, ended, not-found) goes home.
              if (phase !== 'connecting' && phase !== 'waiting') goHome()
            }}
          />
        ) : (
          <>
            <TileActionsContext.Provider
              value={{ canManage: mesh.isHost, onRemove: mesh.kick }}
            >
              {alone ? (
                <WaitingRoom
                  self={self}
                  roomName={roomId}
                  settings={settings}
                  stream={localStream}
                  muted={muted}
                  cameraOff={cameraOff}
                  onToggleMute={() => media.setMicOn(!media.micOn)}
                  onToggleCamera={() => media.setCameraOn(!media.cameraOn)}
                />
              ) : (
                <Stage
                  participants={withLiveState}
                  activeSpeakerId={speakingId}
                  view={view}
                  screenShare={screenShare}
                  controlsVisible={chromeVisible}
                />
              )}
            </TileActionsContext.Provider>
            {/* Remote voices — played independently of the video tiles, silenced by
                "mute speaker", routed to the chosen output. */}
            <RemoteAudio
              peers={remoteParticipants}
              muted={!media.speakerOn}
              sinkId={media.speakerId}
            />

            {/* The socket dropped; we're auto-reconnecting to reclaim our spot. Shown
                even when the chrome is hidden — losing the call matters more than immersion. */}
            {!mesh.connected && <ReconnectingBanner />}

            <RoomChrome
              roomName={roomId}
              count={participantCount}
              visible={chromeVisible}
              onShare={() => setShareOpen(true)}
              raisedHands={raisedHands}
              // Mesh calls are genuinely E2EE — no middlebox exists to trust.
              encryption={participantCount <= 4 ? 'mesh-e2ee' : 'sfu-e2ee'}
            />
            <ControlBar
              muted={muted}
              cameraOff={cameraOff}
              speakerMuted={!media.speakerOn}
              handRaised={handRaised}
              sharing={sharing}
              visible={chromeVisible}
              alone={alone}
              isHost={mesh.isHost}
              layout={layout}
              onToggleMute={() => media.setMicOn(!media.micOn)}
              onToggleSpeaker={() => media.setSpeakerOn(!media.speakerOn)}
              onToggleCamera={() => media.setCameraOn(!media.cameraOn)}
              onToggleHand={() => setHandRaised((v) => !v)}
              onToggleShare={() => void toggleShare()}
              onToggleView={() => setView(layout === 'speaker' ? 'grid' : 'speaker')}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenParticipants={() => setParticipantsOpen(true)}
              onOpenChat={() => setChatOpen(true)}
              chatUnread={chatUnread}
              onReact={mesh.sendReaction}
              onLockView={() => setLocked(true)}
              onLeave={() => {
                setLocked(false)
                setJoined(false)
                goHome()
              }}
              onEndForAll={() => {
                mesh.end()
                setLocked(false)
                setJoined(false)
                goHome()
              }}
            />

            {/* Host-only: anyone knocking at the lobby. */}
            <KnockRequests knocks={mesh.knocks} onAdmit={mesh.admit} onDeny={mesh.deny} />

            {/* Locked (immersive): chrome stays hidden through hover. Only this minimal
                pill surfaces on interaction, so there's always a way back. */}
            {locked && (
              <div
                className={cn(
                  'absolute inset-x-0 bottom-0 flex justify-center pb-5',
                  'transition-all duration-200 ease-out',
                  idle
                    ? 'pointer-events-none translate-y-3 opacity-0'
                    : 'translate-y-0 opacity-100',
                )}
              >
                <button
                  onClick={() => setLocked(false)}
                  className="flex items-center gap-2 rounded-full border border-line/80 bg-surface/80 px-4 py-2.5 shadow-2xl backdrop-blur-2xl transition-colors duration-200 hover:bg-surface-2"
                >
                  <LockIcon className="size-4 text-accent" />
                  <span className="text-[13px] font-medium">Controls hidden · tap to show</span>
                </button>
              </div>
            )}
          </>
        )}

        {inRoom && (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            onChange={patchSettings}
            name={displayName}
            cameraOff={cameraOff}
            muted={muted}
            stream={localStream}
            devices={media.devices}
            cameraId={media.cameraId}
            micId={media.micId}
            speakerId={media.speakerId}
            onSelectCamera={media.selectCamera}
            onSelectMic={media.selectMic}
            onSelectSpeaker={media.selectSpeaker}
          />
        )}

        {inRoom && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} roomName={roomId} />}

        {inRoom && joined && phase === 'admitted' && (
          <ParticipantsPanel
            open={participantsOpen}
            onOpenChange={setParticipantsOpen}
            participants={[selfParticipant, ...remoteParticipants]}
            isHost={mesh.isHost}
            lobbyOpen={mesh.lobbyOpen}
            onSetLobbyOpen={mesh.setLobbyOpen}
          />
        )}

        {inRoom && joined && phase === 'admitted' && (
          <ChatPanel
            open={chatOpen}
            onOpenChange={setChatOpen}
            messages={mesh.messages}
            onSend={mesh.sendChat}
          />
        )}
      </div>
    </TooltipProvider>
  )
}

/** Shown while the signalling socket is down and the transport is retrying. */
function ReconnectingBanner() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center pt-4">
      <div className="flex items-center gap-2.5 rounded-full border border-line/80 bg-surface/90 px-4 py-2 shadow-xl backdrop-blur-2xl">
        <span className="size-2 animate-ping rounded-full bg-accent" />
        <span className="text-[13px] font-medium text-ink">Reconnecting…</span>
      </div>
    </div>
  )
}
