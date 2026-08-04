import { ScreenShareIcon } from '@/design/icons'
import { VideoView } from '@/core/media/VideoView'

/**
 * The featured surface when someone is sharing their screen. Shows the real captured
 * stream once it's flowing; until then (or if only the presence flag has arrived) it
 * holds a labelled placeholder. Fit to *contain* — a screen is never cropped or mirrored.
 */
export function ScreenShareTile({
  presenterName,
  stream,
}: {
  presenterName: string
  stream?: MediaStream | null
}) {
  const isSelf = presenterName === 'You'

  return (
    <div
      className="relative size-full overflow-hidden rounded-(--radius-tile) bg-black ring-1 ring-accent/25 ring-inset"
      style={{ animation: 'samvad-rise 400ms var(--ease-settle) both' }}
    >
      {stream ? (
        <VideoView
          stream={stream}
          label={isSelf ? 'Your shared screen' : `${presenterName}'s shared screen`}
          className="size-full object-contain"
        />
      ) : (
        <div
          className="grid size-full place-items-center"
          style={{
            background: 'radial-gradient(circle at 50% 38%, #23201c 0%, #131110 100%)',
          }}
        >
          <div className="flex flex-col items-center gap-3 text-ink-muted">
            <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-accent">
              <span className="size-7 [&_svg]:size-full">
                <ScreenShareIcon />
              </span>
            </span>
            <span className="text-[14px]">
              {isSelf ? 'You are sharing your screen' : `${presenterName} is sharing`}
            </span>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-linear-to-t from-black/50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-2.5">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-base">
          <span className="size-3 [&_svg]:size-full">
            <ScreenShareIcon />
          </span>
        </span>
        <span className="truncate text-[13px] font-medium text-white drop-shadow-sm">
          {isSelf ? 'You are presenting' : `${presenterName}'s screen`}
        </span>
      </div>
    </div>
  )
}
