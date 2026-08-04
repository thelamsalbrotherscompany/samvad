import type { ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision'
import type { TrackTransform } from '@/core/plugins/types'
import { loadSegmenter } from './segmenter'
import { useBackgroundStore, blurPxFor } from './store'

/**
 * Bakes a background effect into the camera track: segment the person, then replace what's
 * behind them with either a **blurred** copy of the frame or a **chosen image**. Because
 * it's baked into the pixels, both your self-view *and* every peer get it — unlike a local
 * CSS filter, which would leave your real room visible to everyone else.
 *
 * Pipeline: a hidden <video> plays the raw camera → each frame is segmented → composited
 * onto a canvas (background layer underneath, masked-sharp person on top) → the canvas is
 * captured back into a track. Config (blur strength / image) is read live from the plugin
 * store every frame, so toggling strength or swapping the image never restarts the pipeline.
 *
 * Chromium-first by nature (canvas.captureStream + MediaPipe WASM). If the segmenter can't
 * load, {@link start} still returns a track showing the raw camera — the call never breaks
 * over a missing effect.
 */
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

  private segmenter: ImageSegmenter | null = null
  private out: MediaStreamTrack | null = null
  private raf = 0
  private stopped = false
  private lastTs = 0

  /** Begin processing the camera track and return the track to publish (raw until ready). */
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
    // Draw raw passthrough immediately so the output isn't black during model load.
    this.raf = requestAnimationFrame(this.loop)
    void loadSegmenter()
      .then((segmenter) => {
        if (!this.stopped) this.segmenter = segmenter
      })
      .catch(() => {
        // Segmentation unavailable — the loop keeps drawing the raw frame, so video still flows.
      })

    return output
  }

  stop(): void {
    this.stopped = true
    cancelAnimationFrame(this.raf)
    this.out?.stop()
    this.out = null
    if (this.video) {
      this.video.srcObject = null
      this.video.remove()
      this.video = null
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
      if (this.segmenter) {
        const ts = Math.max(this.lastTs + 1, Math.round(performance.now()))
        this.lastTs = ts
        this.segmenter.segmentForVideo(v, ts, (res) => this.composite(res))
      } else {
        ctx.filter = 'none'
        ctx.drawImage(v, 0, 0, w, h)
      }
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private composite(res: ImageSegmenterResult): void {
    const { ctx, video, canvas, personCtx, personCanvas, maskCanvas, maskCtx } = this
    if (!ctx || !video || !canvas || !personCtx || !personCanvas || !maskCanvas || !maskCtx) return
    const mask = res.categoryMask
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

    // Person cut-out: the sharp frame, kept only where the mask is opaque. Scaling the small
    // mask up with smoothing feathers the edge a little.
    personCtx.globalCompositeOperation = 'source-over'
    personCtx.clearRect(0, 0, w, h)
    personCtx.filter = 'none'
    personCtx.drawImage(video, 0, 0, w, h)
    personCtx.globalCompositeOperation = 'destination-in'
    personCtx.imageSmoothingEnabled = true
    personCtx.drawImage(maskCanvas, 0, 0, w, h)
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
