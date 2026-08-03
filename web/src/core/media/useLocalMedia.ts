import { useCallback, useEffect, useRef, useState } from 'react'

export type MediaErrorKind = 'denied' | 'notfound' | 'insecure' | 'other'

export type DeviceList = {
  cameras: MediaDeviceInfo[]
  mics: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
}

export type LocalMedia = {
  stream: MediaStream | null
  /** A live video track exists (independent of whether the camera is currently on). */
  hasCamera: boolean
  error: MediaErrorKind | null
  devices: DeviceList
  micOn: boolean
  cameraOn: boolean
  /** Output on. When false, all incoming audio is silenced (deafen) — applied to
   *  remote audio elements once the mesh lands. Independent of the mic. */
  speakerOn: boolean
  cameraId: string | null
  micId: string | null
  /** Chosen audio output. Applied to remote audio elements (via setSinkId) once the
   *  mesh lands; usable now to route the speaker test. */
  speakerId: string | null
  setMicOn: (on: boolean) => void
  setCameraOn: (on: boolean) => void
  setSpeakerOn: (on: boolean) => void
  selectCamera: (deviceId: string) => void
  selectMic: (deviceId: string) => void
  selectSpeaker: (deviceId: string) => void
}

const EMPTY_DEVICES: DeviceList = { cameras: [], mics: [], speakers: [] }

/**
 * Windows exposes each physical device up to three times: the device itself plus
 * virtual "Default" and "Communications" routes (deviceId 'default'/'communications').
 * Collapse them to one entry per physical device, preferring the concrete one.
 */
function dedupeDevices(list: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const byGroup = new Map<string, MediaDeviceInfo>()
  for (const d of list) {
    if (d.deviceId === 'communications') continue
    const key = d.groupId || d.deviceId
    const prev = byGroup.get(key)
    if (!prev || prev.deviceId === 'default') byGroup.set(key, d)
  }
  return [...byGroup.values()]
}

/**
 * Captures the local camera and microphone. Client-only — no signalling, no backend.
 * Everything degrades gracefully: if permission is denied or there's no device, the
 * stream stays null and the UI falls back to the placeholder it already draws, so a
 * media failure never breaks the app.
 *
 * PHASE 1 note: mic/camera toggling uses `track.enabled`, which keeps the device warm
 * (the camera light may stay on when "off"). Fully stopping the track when the camera
 * is off — the privacy-correct behaviour — is a deliberate follow-up.
 */
export function useLocalMedia(active: boolean): LocalMedia {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<MediaErrorKind | null>(null)
  const [devices, setDevices] = useState<DeviceList>(EMPTY_DEVICES)
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [micId, setMicId] = useState<string | null>(null)
  const [speakerId, setSpeakerId] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices({
        cameras: dedupeDevices(list.filter((d) => d.kind === 'videoinput')),
        mics: dedupeDevices(list.filter((d) => d.kind === 'audioinput')),
        speakers: dedupeDevices(list.filter((d) => d.kind === 'audiooutput')),
      })
    } catch {
      // Non-fatal: device labels just won't populate.
    }
  }, [])

  // Acquire while active; re-acquire when the selected device changes. Inactive (on the
  // landing) means no camera prompt at all, and any live stream is stopped.
  useEffect(() => {
    if (!active) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setStream(null)
      setError(null)
      return
    }
    let cancelled = false

    async function acquire() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('insecure')
        return
      }
      const video = cameraId ? { deviceId: { exact: cameraId } } : true
      // Echo cancellation on, guaranteed — so no one ever hears their own voice bounce
      // back (a caller's speaker bleeding into their mic). Noise suppression + auto gain
      // are the sensible defaults too.
      const audio: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(micId ? { deviceId: { exact: micId } } : {}),
      }

      // Try both, then degrade to whichever single device is present — so a mic-only
      // or camera-only machine still captures what it has instead of failing outright.
      const attempts: MediaStreamConstraints[] = [
        { video, audio },
        { video: false, audio },
        { video, audio: false },
      ]

      let acquired: MediaStream | null = null
      let lastError: MediaErrorKind = 'notfound'
      for (const constraints of attempts) {
        try {
          acquired = await navigator.mediaDevices.getUserMedia(constraints)
          break
        } catch (e) {
          const name = e instanceof DOMException ? e.name : ''
          if (name === 'NotAllowedError' || name === 'SecurityError') {
            lastError = 'denied' // a block applies to the whole request; don't degrade
            break
          }
          lastError =
            name === 'NotFoundError' || name === 'OverconstrainedError' ? 'notfound' : 'other'
        }
      }

      if (cancelled) {
        acquired?.getTracks().forEach((t) => t.stop())
        return
      }
      if (!acquired) {
        setError(lastError)
        return
      }

      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = acquired
      acquired.getAudioTracks().forEach((t) => (t.enabled = micOn))
      acquired.getVideoTracks().forEach((t) => (t.enabled = cameraOn))
      setStream(acquired)
      setError(null)
      void refreshDevices()
    }

    void acquire()
    return () => {
      cancelled = true
    }
    // micOn/cameraOn intentionally excluded — those toggle tracks, not re-acquire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cameraId, micId, refreshDevices])

  // Toggle tracks in place — no re-acquire.
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = micOn))
  }, [micOn, stream])

  useEffect(() => {
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = cameraOn))
  }, [cameraOn, stream])

  // Refresh the device list when hardware is plugged/unplugged.
  useEffect(() => {
    const handler = () => void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handler)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', handler)
  }, [refreshDevices])

  // Stop everything on unmount so the camera light goes out.
  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  return {
    stream,
    hasCamera: !!stream && stream.getVideoTracks().length > 0,
    error,
    devices,
    micOn,
    cameraOn,
    speakerOn,
    cameraId,
    micId,
    speakerId,
    setMicOn,
    setCameraOn,
    setSpeakerOn,
    selectCamera: setCameraId,
    selectMic: setMicId,
    selectSpeaker: setSpeakerId,
  }
}
