import type { ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision'
import { loadSegmenter } from './segmenter'

/** What sits behind the person: a blurred copy of the camera, or a chosen image. */
export type EffectConfig = {
  /** Background blur radius in px. Also the fallback while an image is still loading. */
  blurPx: number
  /** A virtual-background image (data URL), or null for blur. */
  imageUrl: string | null
}

/**
 * Bakes a background effect into a video stream: segment the person, then replace what's
 * behind them with either a **blurred** copy of the frame or a **chosen image**. Because
 * it's baked into the pixels, both your self-view *and* every peer get it — unlike a local
 * CSS filter, which leaves your real room visible to everyone else.
 *
 * Pipeline: a hidden <video> plays the raw camera → each frame is segmented → composited
 * onto a canvas (background layer underneath, masked-sharp person on top) → the canvas is
 * captured back into a MediaStream. Audio passes through untouched.
 *
 * Chromium-first by nature (canvas.captureStream + MediaPipe WASM). If the segmenter can't
 * load, {@link start} rejects and the caller falls back to the raw stream — the call never
 * breaks over a missing effect.
 */
export class BackgroundEffect {
  readonly output: MediaStream

  private blurPx: number
  private imageUrl: string | null
  private image: HTMLImageElement | null = null

  private readonly video: HTMLVideoElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly personCanvas: HTMLCanvasElement
  private readonly personCtx: CanvasRenderingContext2D
  private readonly maskCanvas: HTMLCanvasElement
  private readonly maskCtx: CanvasRenderingContext2D
  private maskImage: ImageData | null = null

  private segmenter: ImageSegmenter | null = null
  private raf = 0
  private stopped = false
  private lastTs = 0

  constructor(raw: MediaStream, config: EffectConfig) {
    this.blurPx = config.blurPx
    this.imageUrl = config.imageUrl
    this.loadImage(config.imageUrl)

    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.srcObject = new MediaStream(raw.getVideoTracks())
    // Kept in the DOM but visually gone — a detached/`display:none` video can stop
    // decoding frames in some engines, which would freeze segmentation.
    Object.assign(this.video.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    })
    document.body.appendChild(this.video)

    this.canvas = document.createElement('canvas')
    this.canvas.width = 640
    this.canvas.height = 480
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D

    this.personCanvas = document.createElement('canvas')
    this.personCtx = this.personCanvas.getContext('2d') as CanvasRenderingContext2D
    this.maskCanvas = document.createElement('canvas')
    this.maskCtx = this.maskCanvas.getContext('2d') as CanvasRenderingContext2D

    const captured = this.canvas.captureStream(30)
    this.output = new MediaStream([...captured.getVideoTracks(), ...raw.getAudioTracks()])
  }

  /** Load the model and begin processing. Rejects if segmentation is unavailable. */
  async start(): Promise<void> {
    await this.video.play().catch(() => {})
    // Draw raw passthrough immediately so the output isn't black during model load.
    this.raf = requestAnimationFrame(this.loop)
    const segmenter = await loadSegmenter()
    if (this.stopped) return
    this.segmenter = segmenter
  }

  stop(): void {
    this.stopped = true
    cancelAnimationFrame(this.raf)
    for (const t of this.output.getVideoTracks()) t.stop()
    this.video.srcObject = null
    this.video.remove()
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

  private readonly loop = (): void => {
    if (this.stopped) return
    const v = this.video
    const w = v.videoWidth
    const h = v.videoHeight
    if (w && h) {
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w
        this.canvas.height = h
        this.personCanvas.width = w
        this.personCanvas.height = h
      }
      if (this.segmenter) {
        const ts = Math.max(this.lastTs + 1, Math.round(performance.now()))
        this.lastTs = ts
        this.segmenter.segmentForVideo(v, ts, (res) => this.composite(res))
      } else {
        this.ctx.filter = 'none'
        this.ctx.drawImage(v, 0, 0, w, h)
      }
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private composite(res: ImageSegmenterResult): void {
    const mask = res.categoryMask
    const { ctx, video, canvas } = this
    const w = canvas.width
    const h = canvas.height

    if (!mask) {
      ctx.filter = 'none'
      ctx.drawImage(video, 0, 0, w, h)
      return
    }

    // Category mask (0 = background) → white-on-transparent alpha image.
    const mw = mask.width
    const mh = mask.height
    const cats = mask.getAsUint8Array()
    if (!this.maskImage || this.maskImage.width !== mw || this.maskImage.height !== mh) {
      this.maskImage = new ImageData(mw, mh)
      this.maskCanvas.width = mw
      this.maskCanvas.height = mh
    }
    const px = this.maskImage.data
    for (let i = 0; i < cats.length; i++) {
      const a = i * 4
      px[a] = 255
      px[a + 1] = 255
      px[a + 2] = 255
      px[a + 3] = cats[i] === 0 ? 0 : 255
    }
    this.maskCtx.putImageData(this.maskImage, 0, 0)

    // Person cut-out: the sharp frame, kept only where the mask is opaque. Scaling the
    // small mask up with smoothing feathers the edge a little.
    const pc = this.personCtx
    pc.globalCompositeOperation = 'source-over'
    pc.clearRect(0, 0, w, h)
    pc.filter = 'none'
    pc.drawImage(video, 0, 0, w, h)
    pc.globalCompositeOperation = 'destination-in'
    pc.imageSmoothingEnabled = true
    pc.drawImage(this.maskCanvas, 0, 0, w, h)
    pc.globalCompositeOperation = 'source-over'

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
    ctx.drawImage(this.personCanvas, 0, 0, w, h)
  }
}

/** Draw an image covering w×h, preserving aspect (like CSS object-fit: cover). */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
): void {
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
