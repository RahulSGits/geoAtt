/**
 * Face detection, liveness and recognition for the browser.
 *
 * Two engines, each doing what it is genuinely best at:
 *
 *   MediaPipe FaceLandmarker  — detection, framing quality, and liveness.
 *     Ships 478 landmarks plus *blendshapes*, including `eyeBlinkLeft` and
 *     `eyeBlinkRight`. Those are trained outputs, far more reliable than the
 *     hand-rolled eye-aspect-ratio threshold this used before, which mistook
 *     downward glances and narrow eyes for blinks.
 *
 *   face-api faceRecognitionNet — the 128-float identity descriptor.
 *     MediaPipe has no face-recognition task at all, and hand-rolling the
 *     crop/align step that feeds an embedding model is exactly where accuracy
 *     is lost. face-api's own detect→landmark→align→descriptor pipeline is
 *     left intact and is the sole source of the descriptor.
 *
 * MediaPipe runs every frame as a cheap gate; the heavier face-api pass only
 * runs on frames that already look good, so the expensive model runs less than
 * it used to.
 *
 * Everything here touches `window`, so import it lazily from a `"use client"`
 * component — never from a server component or action.
 */

import type * as FaceApi from '@vladmandic/face-api'
import type { FaceLandmarker as FaceLandmarkerType } from '@mediapipe/tasks-vision'

export const MODEL_URL = '/models'
export const MEDIAPIPE_URL = '/mediapipe'

/**
 * Euclidean distance below which two descriptors are the same person.
 * face-api's own default is 0.6; attendance is a security control, so this is
 * tightened to trade a few extra retries for far fewer false accepts.
 */
export const MATCH_THRESHOLD = 0.5

/** Blendshape score above which an eye counts as shut. */
const BLINK_CLOSED = 0.45
/** ...and below which it counts as open again. */
const BLINK_OPEN = 0.2

let faceapi: typeof FaceApi | null = null
let landmarker: FaceLandmarkerType | null = null
let loadPromise: Promise<void> | null = null

/**
 * Load both engines once per page. Concurrent callers share the promise, so
 * opening the camera twice does not fetch ~10 MB twice.
 */
export function loadFaceModels(): Promise<void> {
  if (faceapi && landmarker) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const [faceApiLib, vision] = await Promise.all([
      import('@vladmandic/face-api'),
      import('@mediapipe/tasks-vision'),
    ])

    const { FaceLandmarker, FilesetResolver } = vision

    await Promise.all([
      // Only the recognition net — MediaPipe handles detection and landmarks,
      // but face-api still needs its own detector for the aligned descriptor.
      faceApiLib.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceApiLib.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceApiLib.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      (async () => {
        // Self-hosted: no third-party CDN at runtime, so the CSP stays 'self'.
        const fileset = await FilesetResolver.forVisionTasks(`${MEDIAPIPE_URL}/wasm`)
        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: `${MEDIAPIPE_URL}/face_landmarker.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        })
      })(),
    ])

    faceapi = faceApiLib
  })()

  loadPromise.catch(() => {
    // Let a later attempt retry rather than caching the rejection forever.
    loadPromise = null
  })

  return loadPromise
}

/** Head poses captured during enrollment, in the order they are asked for. */
export const ENROLL_POSES = ['center', 'left', 'right', 'up'] as const
export type Pose = (typeof ENROLL_POSES)[number]

export const POSE_PROMPT: Record<Pose, string> = {
  center: 'Look straight at the camera',
  left: 'Slowly turn your head to the left',
  right: 'Now turn your head to the right',
  up: 'Now tilt your chin up',
}

/**
 * Classify head pose from landmarks.
 *
 * Yaw comes from how far the nose sits between the two ear/cheek anchors, and
 * pitch from the nose height between brow and chin. Both are ratios, so they
 * are independent of distance from the camera and of frame size.
 */
export function classifyPose(landmarks: { x: number; y: number }[]): Pose | null {
  if (landmarks.length < 400) return null

  const nose = landmarks[1]
  const leftCheek = landmarks[234]
  const rightCheek = landmarks[454]
  const brow = landmarks[10]
  const chin = landmarks[152]
  if (!nose || !leftCheek || !rightCheek || !brow || !chin) return null

  const span = rightCheek.x - leftCheek.x
  if (Math.abs(span) < 1e-6) return null

  // 0 = hard left, 1 = hard right, 0.5 = centred.
  const yaw = (nose.x - leftCheek.x) / span
  const height = chin.y - brow.y
  const pitch = height === 0 ? 0.5 : (nose.y - brow.y) / height

  if (yaw < 0.36) return 'right'
  if (yaw > 0.64) return 'left'
  if (pitch < 0.42) return 'up'
  if (yaw > 0.42 && yaw < 0.58) return 'center'
  return null
}

export interface FaceFrame {
  /** Present only on frames that passed the quality gate. */
  descriptor: Float32Array | null
  /** Detector confidence proxy, 0..1. */
  score: number
  /** Highest of the two eye-blink blendshapes, 0..1. */
  blink: number
  /** Head pose, or null when between recognised positions. */
  pose: Pose | null
  box: { x: number; y: number; width: number; height: number }
}

/**
 * Analyse one video frame.
 *
 * `withDescriptor` gates the expensive face-api pass: the caller runs the cheap
 * MediaPipe check every frame and only asks for a descriptor once the face is
 * framed well, which keeps the loop responsive.
 */
export async function analyseFrame(
  video: HTMLVideoElement,
  withDescriptor = false,
): Promise<FaceFrame | null> {
  await loadFaceModels()
  if (!landmarker || !faceapi) return null

  const result = landmarker.detectForVideo(video, performance.now())
  const landmarks = result.faceLandmarks?.[0]
  if (!landmarks || landmarks.length === 0) return null

  // Landmarks are normalised 0..1; convert to pixels for the framing checks.
  const width = video.videoWidth || 640
  const height = video.videoHeight || 480

  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const point of landmarks) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }

  const box = {
    x: minX * width,
    y: minY * height,
    width: (maxX - minX) * width,
    height: (maxY - minY) * height,
  }

  const blink = blinkScore(result.faceBlendshapes?.[0]?.categories)

  let descriptor: Float32Array | null = null
  if (withDescriptor) {
    // face-api's own pipeline, unchanged — detection, 68 landmarks, alignment
    // and embedding all happen inside it, which is what keeps matching
    // accurate. Re-cropping by hand here is where accuracy would be lost.
    const detection = await faceapi
      .detectSingleFace(
        video,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }),
      )
      .withFaceLandmarks()
      .withFaceDescriptor()

    if (detection) descriptor = detection.descriptor
  }

  return { descriptor, score: 1, blink, pose: classifyPose(landmarks), box }
}

/** Highest of the two eye-blink blendshapes. */
function blinkScore(
  categories?: { categoryName?: string; displayName?: string; score: number }[],
): number {
  if (!categories) return 0
  let highest = 0
  for (const category of categories) {
    const name = category.categoryName ?? category.displayName ?? ''
    if (name === 'eyeBlinkLeft' || name === 'eyeBlinkRight') {
      if (category.score > highest) highest = category.score
    }
  }
  return highest
}

/**
 * A stored enrollment: either one 128-float template (older records) or one per
 * captured pose.
 */
export type StoredTemplate = number[] | number[][]

/** Normalise either stored shape to a list of templates. */
export function templatesOf(stored: StoredTemplate | null | undefined): number[][] {
  if (!stored || stored.length === 0) return []
  return Array.isArray(stored[0]) ? (stored as number[][]) : [stored as number[]]
}

/**
 * Compare a live descriptor against every enrolled pose and take the closest.
 *
 * Matching against the nearest pose rather than one averaged template is what
 * makes a head turn at check-in still recognisable — averaging across poses
 * blurs the embedding and pushes every angle equally far away.
 */
export function matchDescriptor(
  live: Float32Array | number[],
  enrolled: StoredTemplate,
): { matched: boolean; distance: number; confidence: number } {
  const templates = templatesOf(enrolled)
  let distance = Number.POSITIVE_INFINITY
  for (const template of templates) {
    const d = euclidean(live, template)
    if (d < distance) distance = d
  }
  return {
    matched: distance < MATCH_THRESHOLD,
    distance,
    confidence: Math.max(0, Math.min(1, 1 - distance / 0.8)),
  }
}

function euclidean(a: Float32Array | number[], b: Float32Array | number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum)
}

/**
 * Blink-based liveness gate, driven by MediaPipe blendshapes.
 *
 * A printed photo or a still on a phone screen holds a constant blink score.
 * Requiring it to rise above CLOSED and fall back below OPEN proves an eyelid
 * actually moved, which a flat image cannot fake.
 */
export class LivenessTracker {
  private sawClose = false

  blinked = false

  /** Feed one frame's blink score. True once a full blink has been observed. */
  push(score: number): boolean {
    if (this.blinked) return true

    if (score > BLINK_CLOSED) this.sawClose = true
    else if (this.sawClose && score < BLINK_OPEN) this.blinked = true

    return this.blinked
  }

  reset() {
    this.sawClose = false
    this.blinked = false
  }
}

/**
 * Average several descriptors into one enrollment template. Averaging across
 * frames smooths out a single unlucky angle or exposure, which materially
 * reduces false rejects at check-in.
 */
export function averageDescriptors(samples: Float32Array[]): number[] {
  if (samples.length === 0) return []
  const length = samples[0].length
  const out = new Array<number>(length).fill(0)
  for (const sample of samples) {
    for (let i = 0; i < length; i++) out[i] += sample[i]
  }
  return out.map((v) => v / samples.length)
}

/** Grab the current video frame as a JPEG blob for the audit trail. */
export function captureFrame(
  video: HTMLVideoElement,
  maxWidth = 480,
): Promise<Blob | null> {
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((video.videoWidth || maxWidth) * scale)
  canvas.height = Math.round((video.videoHeight || maxWidth) * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8),
  )
}
