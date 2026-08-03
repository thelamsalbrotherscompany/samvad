import type { ImageSegmenter } from '@mediapipe/tasks-vision'

/**
 * Person segmentation for background effects, via MediaPipe's Selfie Segmenter.
 *
 * The model and its WASM run **entirely on-device** — the camera frames never leave the
 * machine, which is the whole point of a privacy client doing this itself. Both assets are
 * served from our own origin (`public/mediapipe/`), never a CDN (a non-negotiable), and
 * are pulled by a **dynamic import** only when a user first turns an effect on — so a call
 * with no effects never downloads the ~11 MB WASM.
 *
 * The segmenter is a cached singleton, reused across enable/disable toggles.
 */

let segmenterPromise: Promise<ImageSegmenter> | null = null

export function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = create().catch((e: unknown) => {
      segmenterPromise = null // let a later attempt retry rather than cache the failure
      throw e
    })
  }
  return segmenterPromise
}

async function create(): Promise<ImageSegmenter> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe')
  return ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: '/mediapipe/selfie_segmenter.tflite',
      // GPU delegate keeps segmentation off the CPU; it falls back internally if absent.
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    // A per-pixel category index (0 = background) is all the compositor needs.
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  })
}
