import type { ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision'
import type { TrackTransform } from '@/core/plugins/types'
import { loadSegmenter } from './segmenter'
import { useBackgroundStore, blurPxFor } from './store'
import type { FrameMessage, MaskMessage, ErrorMessage } from './segmenter.worker'

/**
 * Bakes a background effect into the camera track: segment the person, then replace what's
 * behind them with a **blurred** copy of the frame or a **chosen image**. Baked into the
 * pixels, so both your self-view *and* every peer get it — unlike a local CSS filter, which
 * would leave your real room visible to everyone else. Config (blur strength / image) is
 * read live from the plugin store each frame.
 *
 * Segmentation runs in a **Web Worker** ({@link ./segmenter.worker}) when the browser
 * supports it — MediaPipe inference and the O(pixels) mask loop leave the main thread, which
 * only composites. The output is always a plain `<canvas>.captureStream()` (no
 * `MediaStreamTrackGenerator`), so it stays cross-browser and can never emit a black frame:
 * the loop draws raw until a mask arrives. If the worker can't segment, it falls back to
 * segmenting on the main thread — the pre-worker path, unchanged.
 */

const WORKER_TIMEOUT_MS = 4000

function supportsWorkerPipeline(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  )
}

export class BackgroundTransform implements TrackTransform {
  private blurPx = 9
  private imageUrl: string | null = null
  private image: HTMLImageElement | null = null

  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private personCanvas: HTMLCanvasElement | null = null
  private personCtx: CanvasRenderingContext2D | null = null
  private maskCanvas: HTMLCanvasElement | null = null
  private maskCtx: CanvasRenderingContext2D | null = null
  private maskImage: ImageData | null = null

  // Worker path
  private worker: Worker | null = null
  private useWorker = false
  private inFlight = false // one frame in flight at a time — self-throttling under load
  private latestMask: ImageBitmap | null = null
  private workerProduced = false
  private firstFrameAt = 0

  // Main-thread fallback path
  private segmenter: ImageSegmenter | null = null

  private out: MediaStreamTrack | null = null
  private raf = 0
  private stopped = false
  private lastTs = 0

  start(input: MediaStreamTrack): MediaStreamTrack {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = new MediaStream([input])
    // Kept in the DOM but visually gone — a detached/`display:none` video can stop decoding
    // frames in some engines, which would freeze segmentation.
    Object.assign(video.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    })
    document.body.appendChild(video)
    this.video = video

    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    this.canvas = canvas
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D

    this.personCanvas = document.createElement('canvas')
    this.personCtx = this.personCanvas.getContext('2d') as CanvasRenderingContext2D
    this.maskCanvas = document.createElement('canvas')
    this.maskCtx = this.maskCanvas.getContext('2d') as CanvasRenderingContext2D

    const output = canvas.captureStream(30).getVideoTracks()[0]
    this.out = output

    void video.play().catch(() => {})

    // Prefer the worker; fall back to main-thread segmentation if it's unsupported/fails.
    if (supportsWorkerPipeline()) this.initWorker()
    else void this.loadMainThreadSegmenter()

    // Draw raw passthrough immediately so the output isn't black during model load.
    this.raf = requestAnimationFrame(this.loop)
    return output
  }

  stop(): void {
    this.stopped = true
    cancelAnimationFrame(this.raf)
    this.worker?.terminate()
    this.worker = null
    this.latestMask?.close()
    this.latestMask = null
    this.out?.stop()
    this.out = null
    if (this.video) {
      this.video.srcObject = null
      this.video.remove()
      this.video = null
    }
  }

  private initWorker(): void {
    try {
      const worker = new Worker(new URL('./segmenter.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<MaskMessage | ErrorMessage>) => {
        const msg = e.data
        if (msg.type === 'mask') {
          this.latestMask?.close()
          this.latestMask = msg.bitmap
          this.workerProduced = true
          this.inFlight = false
        } else if (msg.type === 'error') {
          this.fallbackToMainThread()
        }
      }
      worker.onerror = () => this.fallbackToMainThread()
      this.worker = worker
      this.useWorker = true
    } catch {
      this.fallbackToMainThread()
    }
  }

  /** Give up on the worker and segment on the main thread instead. */
  private fallbackToMainThread(): void {
    if (!this.useWorker) return
    this.useWorker = false
    this.worker?.terminate()
    this.worker = null
    this.inFlight = false
    void this.loadMainThreadSegmenter()
  }

  private async loadMainThreadSegmenter(): Promise<void> {
    try {
      const segmenter = await loadSegmenter()
      if (!this.stopped) this.segmenter = segmenter
    } catch {
      // Segmentation unavailable — the loop keeps drawing the raw frame, so video still flows.
    }
  }

  private loadImage(url: string | null): void {
    this.imageUrl = url
    if (!url) {
      this.image = null
      return
    }
    const img = new Image()
    img.onload = () => {
      // Ignore a stale load if the config changed while decoding.
      if (this.imageUrl === url) this.image = img
    }
    img.onerror = () => {
      if (this.imageUrl === url) this.image = null // fall back to blur
    }
    img.src = url
  }

  private nextTs(): number {
    const ts = Math.max(this.lastTs + 1, Math.round(performance.now()))
    this.lastTs = ts
    return ts
  }

  private readonly loop = (): void => {
    if (this.stopped) return
    const v = this.video
    const canvas = this.canvas
    const ctx = this.ctx
    if (!v || !canvas || !ctx) return

    // Live config: blur strength + chosen image come straight from the plugin store.
    const state = useBackgroundStore.getState()
    this.blurPx = blurPxFor(state.mode)
    if (state.image !== this.imageUrl) this.loadImage(state.image)

    const w = v.videoWidth
    const h = v.videoHeight
    if (w && h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        if (this.personCanvas) {
          this.personCanvas.width = w
          this.personCanvas.height = h
        }
      }
      if (this.useWorker) {
        this.runWorkerFrame(v, w, h)
      } else if (this.segmenter) {
        this.segmenter.segmentForVideo(v, this.nextTs(), (res) => this.compositeFromResult(res))
      } else {
        ctx.filter = 'none'
        ctx.drawImage(v, 0, 0, w, h)
      }
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  /** Worker path: dispatch a frame if the last one came back, composite with the latest mask. */
  private runWorkerFrame(v: HTMLVideoElement, w: number, h: number): void {
    const worker = this.worker
    if (worker && !this.inFlight) {
      this.inFlight = true
      if (!this.firstFrameAt) this.firstFrameAt = performance.now()
      createImageBitmap(v)
        .then((bitmap) => {
          if (this.stopped || !this.worker) {
            bitmap.close()
            this.inFlight = false
            return
          }
          const msg: FrameMessage = { type: 'frame', bitmap, ts: this.nextTs() }
          this.worker.postMessage(msg, [bitmap])
        })
        .catch(() => {
          this.inFlight = false
        })
    }

    // If the worker never produced a mask in a reasonable window, drop to the main thread.
    if (!this.workerProduced && this.firstFrameAt && performance.now() - this.firstFrameAt > WORKER_TIMEOUT_MS) {
      this.fallbackToMainThread()
    }

    if (this.latestMask) this.compositeWithMask(v, this.latestMask, w, h)
    else {
      const ctx = this.ctx!
      ctx.filter = 'none'
      ctx.drawImage(v, 0, 0, w, h)
    }
  }

  /** Main-thread path: build the alpha mask from a segmentation result, then composite. */
  private compositeFromResult(res: ImageSegmenterResult): void {
    const { video, maskCanvas, maskCtx } = this
    const mask = res.categoryMask
    if (!video || !maskCanvas || !maskCtx) return
    if (!mask) {
      const ctx = this.ctx
      const canvas = this.canvas
      if (ctx && canvas) {
        ctx.filter = 'none'
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      }
      return
    }

    const mw = mask.width
    const mh = mask.height
    const cats = mask.getAsUint8Array()
    if (!this.maskImage || this.maskImage.width !== mw || this.maskImage.height !== mh) {
      this.maskImage = new ImageData(mw, mh)
      maskCanvas.width = mw
      maskCanvas.height = mh
    }
    const px = this.maskImage.data
    for (let i = 0; i < cats.length; i++) {
      const a = i * 4
      px[a] = 255
      px[a + 1] = 255
      px[a + 2] = 255
      px[a + 3] = cats[i] === 0 ? 0 : 255
    }
    maskCtx.putImageData(this.maskImage, 0, 0)
    this.compositeWithMask(video, maskCanvas, video.videoWidth, video.videoHeight)
  }

  /**
   * Shared final compositing, given an alpha `maskDrawable` (opaque over the person): cut the
   * sharp person out of the frame, draw the background (image or blurred frame) underneath,
   * then the person on top. Used by both the worker and main-thread paths.
   */
  private compositeWithMask(video: HTMLVideoElement, maskDrawable: CanvasImageSource, w: number, h: number): void {
    const { ctx, personCtx, personCanvas } = this
    if (!ctx || !personCtx || !personCanvas) return

    // Person cut-out: the sharp frame, kept only where the mask is opaque. Scaling the mask
    // up with smoothing feathers the edge a little.
    personCtx.globalCompositeOperation = 'source-over'
    personCtx.clearRect(0, 0, w, h)
    personCtx.filter = 'none'
    personCtx.drawImage(video, 0, 0, w, h)
    personCtx.globalCompositeOperation = 'destination-in'
    personCtx.imageSmoothingEnabled = true
    personCtx.drawImage(maskDrawable, 0, 0, w, h)
    personCtx.globalCompositeOperation = 'source-over'

    // Background layer: the chosen image (cover-fit) if it's ready, else a blurred frame.
    const img = this.image
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.filter = 'none'
      drawCover(ctx, img, w, h)
    } else {
      ctx.filter = `blur(${this.blurPx}px)`
      ctx.drawImage(video, 0, 0, w, h)
      ctx.filter = 'none'
    }

    // Sharp person on top.
    ctx.drawImage(personCanvas, 0, 0, w, h)
  }
}

/** Draw an image covering w×h, preserving aspect (like CSS object-fit: cover). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number): void {
  const ir = img.naturalWidth / img.naturalHeight
  const cr = w / h
  let dw: number
  let dh: number
  if (ir > cr) {
    dh = h
    dw = h * ir
  } else {
    dw = w
    dh = w / ir
  }
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}
