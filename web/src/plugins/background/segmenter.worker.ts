import type { ImageSegmenter, ImageSegmenterResult } from '@mediapipe/tasks-vision'

/**
 * Segmentation worker: keeps MediaPipe (model load, GPU inference, and the O(pixels)
 * mask→alpha loop) off the main thread. It receives a camera frame as an `ImageBitmap`,
 * segments it, builds a white-on-transparent alpha mask on an `OffscreenCanvas`, and posts
 * that mask back as an `ImageBitmap` (transferred). The main thread does the final
 * compositing — so the output still comes from a plain `<canvas>.captureStream()`, the
 * proven cross-browser path, with no `MediaStreamTrackGenerator` involved.
 *
 * If the model can't load, it posts `{ type: 'error' }` and the main thread falls back to
 * segmenting on the main thread. Either way video keeps flowing (raw until a mask arrives).
 */

// The dedicated-worker globals we use, typed without pulling in the webworker lib (which
// would clash with the DOM lib this file is compiled under).
type WorkerScope = {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}
const ctx = self as unknown as WorkerScope

export type FrameMessage = { type: 'frame'; bitmap: ImageBitmap; ts: number }
export type MaskMessage = { type: 'mask'; bitmap: ImageBitmap }
export type ErrorMessage = { type: 'error' }

let segmenter: ImageSegmenter | null = null
let loading: Promise<void> | null = null
let failed = false

let maskCanvas: OffscreenCanvas | null = null
let maskCtx: OffscreenCanvasRenderingContext2D | null = null
let maskData: ImageData | null = null

function ensureSegmenter(): Promise<void> {
  if (!loading) {
    loading = create().catch(() => {
      failed = true
      ctx.postMessage({ type: 'error' } satisfies ErrorMessage)
    })
  }
  return loading
}

async function create(): Promise<void> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe')
  segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: '/mediapipe/selfie_segmenter.tflite',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  })
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data as FrameMessage
  if (msg.type !== 'frame') return
  const { bitmap, ts } = msg
  if (failed) {
    bitmap.close()
    return
  }
  void ensureSegmenter().then(() => {
    if (!segmenter) {
      bitmap.close()
      return
    }
    // VIDEO mode invokes the callback synchronously and frees the result after it returns,
    // so the mask must be built inside it.
    segmenter.segmentForVideo(bitmap, ts, (res: ImageSegmenterResult) => {
      const out = buildMask(res)
      if (out) ctx.postMessage({ type: 'mask', bitmap: out } satisfies MaskMessage, [out])
    })
    bitmap.close()
  })
}

/** Category mask (0 = background) → white-on-transparent alpha, as a transferable bitmap. */
function buildMask(res: ImageSegmenterResult): ImageBitmap | null {
  const cat = res.categoryMask
  if (!cat) return null
  const w = cat.width
  const h = cat.height
  const cats = cat.getAsUint8Array()
  if (!maskCanvas || maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas = new OffscreenCanvas(w, h)
    maskCtx = maskCanvas.getContext('2d')
    maskData = new ImageData(w, h)
  }
  if (!maskCtx || !maskData) return null
  const px = maskData.data
  for (let i = 0; i < cats.length; i++) {
    const a = i * 4
    px[a] = 255
    px[a + 1] = 255
    px[a + 2] = 255
    px[a + 3] = cats[i] === 0 ? 0 : 255
  }
  maskCtx.putImageData(maskData, 0, 0)
  return maskCanvas.transferToImageBitmap()
}
