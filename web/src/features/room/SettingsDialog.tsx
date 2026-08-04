import { type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { Button, Select, Toggle } from '@/design/primitives'
import { CloseIcon } from '@/design/icons'
import { initialsOf } from '@/core/participants'
import { VideoView } from '@/core/media/VideoView'
import type { DeviceList } from '@/core/media/useLocalMedia'
import { useSettingsPanels } from '@/core/plugins/settingsRegistry'
import { MicMeter } from '@/features/room/MicMeter'
import { selfVideoStyle, type Settings } from '@/lib/settings'
import { cn } from '@/lib/cn'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  name: string
  cameraOff: boolean
  muted: boolean
  stream: MediaStream | null
  devices: DeviceList
  cameraId: string | null
  micId: string | null
  speakerId: string | null
  onSelectCamera: (deviceId: string) => void
  onSelectMic: (deviceId: string) => void
  onSelectSpeaker: (deviceId: string) => void
}

/** Play a short, gentle tone through the chosen output so the speaker can be tested. */
async function playTestTone(deviceId: string | null) {
  try {
    const ctx = new AudioContext()
    const sinkable = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
    if (deviceId && typeof sinkable.setSinkId === 'function') {
      try {
        await sinkable.setSinkId(deviceId)
      } catch {
        // Fall back to the system default output.
      }
    }
    await ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 587.33 // D5 — pleasant, unmistakable
    const t = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(t + 0.6)
    osc.onended = () => void ctx.close()
  } catch {
    // No audio output available.
  }
}

const SHORTCUTS: [keys: string[], desc: string][] = [
  [['M'], 'Toggle microphone'],
  [['V'], 'Toggle camera'],
  [['H'], 'Raise / lower hand'],
  [['F'], 'Full screen'],
  [['Space'], 'Push to talk (hold)'],
]

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  name,
  cameraOff,
  muted,
  stream,
  devices,
  cameraId,
  micId,
  speakerId,
  onSelectCamera,
  onSelectMic,
  onSelectSpeaker,
}: Props) {
  const initials = initialsOf(name || 'You')
  const showVideo = !cameraOff && !!stream && stream.getVideoTracks().length > 0
  const hasMic = !!stream && stream.getAudioTracks().length > 0
  // Plugin-contributed Settings sections (e.g. the background picker) — core owns none of it.
  const pluginPanels = useSettingsPanels()

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(92vw,540px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-[18px] font-semibold">Settings</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <CloseIcon className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Camera, microphone, and video effect settings
          </Dialog.Description>

          {/* Live preview — mirror flips it; the background effect is baked into the stream. */}
          <div
            className="mt-4 aspect-video w-full overflow-hidden rounded-xl ring-1 ring-line/60"
            style={{
              background: cameraOff
                ? 'var(--color-surface)'
                : 'linear-gradient(145deg, #4a2f24 0%, #241813 100%)',
            }}
          >
            {showVideo && stream ? (
              <VideoView stream={stream} label="Your camera preview" className="size-full" style={selfVideoStyle(settings)} />
            ) : (
              <div className="grid size-full place-items-center">
                <span className="text-6xl font-semibold text-ink/12 select-none">
                  {cameraOff ? 'Camera off' : initials}
                </span>
              </div>
            )}
          </div>

          <div className="mt-6 space-y-6">
            <Section title="Video">
              <Row
                label="Mirror my view"
                hint="See yourself like a mirror — raise your right hand, it's on your right. Only affects your view."
              >
                <Toggle
                  label="Mirror my view"
                  checked={settings.mirror}
                  onCheckedChange={(v) => onChange({ mirror: v })}
                />
              </Row>
              <Row
                label="Mirror everyone"
                hint="Off by default (like Google Meet). Turn on to flip others too so their raised hands match yours — but text they hold up reads reversed. Screen shares never mirror."
              >
                <Toggle
                  label="Mirror everyone"
                  checked={settings.mirrorRemote}
                  onCheckedChange={(v) => onChange({ mirrorRemote: v })}
                />
              </Row>
            </Section>

            {/* Media plugins (e.g. background effects) contribute their own sections here. */}
            {pluginPanels.map((Panel, i) => (
              <Panel key={i} />
            ))}

            <Section title="Devices">
              <Field label="Camera">
                <DeviceSelect
                  devices={devices.cameras}
                  value={cameraId}
                  fallback="Camera"
                  onChange={onSelectCamera}
                />
              </Field>

              <Field label="Microphone">
                <DeviceSelect
                  devices={devices.mics}
                  value={micId}
                  fallback="Microphone"
                  onChange={onSelectMic}
                />
                {hasMic ? (
                  // Live level — talk and watch it move to confirm the mic works.
                  <MicMeter stream={stream} muted={muted} className="mt-2.5" />
                ) : (
                  <p className="mt-2 text-[12px] text-ink-faint">No microphone detected.</p>
                )}
              </Field>

              <Field label="Speaker">
                <div className="flex items-center gap-2">
                  {devices.speakers.length > 0 ? (
                    <div className="min-w-0 flex-1">
                      <DeviceSelect
                        devices={devices.speakers}
                        value={speakerId}
                        fallback="Speaker"
                        onChange={onSelectSpeaker}
                      />
                    </div>
                  ) : (
                    <span className="flex-1 text-[13px] text-ink-faint">System default</span>
                  )}
                  <Button variant="secondary" onClick={() => void playTestTone(speakerId)}>
                    Test
                  </Button>
                </div>
                <p className="mt-2 text-[12px] text-ink-faint">
                  Press Test — you should hear a short tone.
                </p>
              </Field>
            </Section>

            <Section title="Audio">
              <Row label="Noise suppression" hint="Reduce background sound on your mic.">
                <Toggle
                  label="Noise suppression"
                  checked={settings.noiseSuppression}
                  onCheckedChange={(v) => onChange({ noiseSuppression: v })}
                />
              </Row>
            </Section>

            <Section title="Keyboard shortcuts">
              <dl className="space-y-2 text-[13px]">
                {SHORTCUTS.map(([keys, desc]) => (
                  <div key={desc} className="flex items-center justify-between gap-4">
                    <dt className="text-ink-muted">{desc}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-ink"
                        >
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          </div>

          <p className="mt-6 text-[12px] leading-relaxed text-ink-faint">
            Background effects run entirely on your device — the segmentation model loads the
            first time you turn one on, and neither your video nor a background image you pick
            ever leaves your machine. Mirroring affects only your own view.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-medium tracking-wide text-ink-faint uppercase">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** Stacked label-over-control, for full-width inputs like device pickers. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[14px] text-ink">{label}</div>
      {children}
    </div>
  )
}

function Row({
  label,
  hint,
  stacked,
  children,
}: {
  label: string
  hint?: string
  stacked?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        stacked ? 'flex flex-col gap-2' : 'flex items-center justify-between gap-4',
      )}
    >
      <div>
        <div className="text-[14px] text-ink">{label}</div>
        {hint && <div className="text-[12px] text-ink-faint">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function DeviceSelect({
  devices,
  value,
  fallback,
  onChange,
}: {
  devices: MediaDeviceInfo[]
  value: string | null
  fallback: string
  onChange: (deviceId: string) => void
}) {
  if (devices.length === 0) {
    return <span className="text-[13px] text-ink-faint">No device</span>
  }
  const items = devices.map((d, i) => ({
    value: d.deviceId,
    label: d.label || `${fallback} ${i + 1}`,
  }))
  return (
    <Select
      value={value ?? devices[0]?.deviceId ?? ''}
      onValueChange={onChange}
      items={items}
      label={fallback}
    />
  )
}
