'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Building2,
  Camera,
  CheckCircle2,
  Eye,
  MapPin,
  Home,
  ScanFace,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import {
  analyseFrame,
  captureFrame,
  ENROLL_POSES,
  LivenessTracker,
  loadFaceModels,
  matchDescriptor,
  POSE_PROMPT,
} from '@/lib/face'
import {
  checkGeofence,
  formatDistance,
  getCurrentPosition,
  GeolocationFailure,
  type Coords,
} from '@/lib/geo'
import { enforcesGeofence, workModeMeta } from '@/lib/types'
import type { Shift, Site, WorkMode } from '@/lib/types'
import { Alert, Spinner } from './ui'

type Phase =
  | 'idle'
  | 'locating'
  | 'camera'
  | 'models'
  | 'scanning'
  | 'blink'
  | 'capturing'
  | 'submitting'
  | 'done'
  | 'error'

const PHASE_COPY: Record<Phase, string> = {
  idle: 'Ready when you are',
  locating: 'Confirming you are on site…',
  camera: 'Starting the camera…',
  models: 'Loading face recognition…',
  scanning: 'Hold still — looking for your face',
  blink: 'Blink once to prove you are live',
  capturing: 'Capturing…',
  submitting: 'Recording your attendance…',
  done: 'Done',
  error: 'Something needs your attention',
}

/** Detector cadence — fast enough to catch a blink, light enough for laptops. */
const FRAME_INTERVAL_MS = 180
/** Give up rather than hold the camera open forever. */
const SCAN_TIMEOUT_MS = 60_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface CheckInPayload {
  /** One template per captured pose at enrollment; a single one at check-in. */
  templates?: number[][]
  descriptor: number[]
  selfie: Blob | null
  coords: Coords
  liveness: 'blink'
  workMode: WorkMode
}

class Aborted extends Error {}

export default function FaceCheckIn({
  mode,
  site,
  shift,
  workModes = ['on_site'],
  enrolledDescriptor,
  onSubmit,
  onCancel,
}: {
  mode: 'enroll' | 'verify' | 'checkout'
  /** Required for `verify`; the fence is checked before the camera opens. */
  site?: Site | null
  shift?: Shift | null
  /** Modes the employee may pick. One entry hides the selector. */
  workModes?: WorkMode[]
  enrolledDescriptor?: number[] | number[][] | null
  onSubmit: (payload: CheckInPayload) => Promise<{ ok: boolean; error?: string }>
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const abortedRef = useRef(false)

  // The run loop outlives the render that started it, so anything it calls has
  // to be reached through a ref — a captured `onSubmit` would be pinned to
  // whichever render kicked the loop off.
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [coords, setCoords] = useState<Coords | null>(null)
  const [distance, setDistance] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [samplesTaken, setSamplesTaken] = useState(0)
  const [blinked, setBlinked] = useState(false)
  const [faceVisible, setFaceVisible] = useState(false)
  const [workMode, setWorkMode] = useState<WorkMode>(workModes[0] ?? 'on_site')

  // Only an on-site day at a fenced office needs a position check.
  const needsLocation =
    mode === 'verify' && workMode === 'on_site' && Boolean(site && enforcesGeofence(site, shift))

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    // The camera light must go out the moment this component leaves the tree.
    return () => {
      abortedRef.current = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    abortedRef.current = false
    setError(null)
    setHint(null)
    setProgress(0)
    setSamplesTaken(0)
    setBlinked(false)
    setFaceVisible(false)

    const liveness = new LivenessTracker()
    const samples: Float32Array[] = []
    // One template per pose, so check-in can match the closest angle rather
    // than an average that fits none of them well.
    const captured: number[][] = []
    let wantedPose = 0

    /** Bail out of the run if the user cancelled or the dialog closed. */
    const checkAborted = () => {
      if (abortedRef.current) throw new Aborted()
    }

    try {
      /* 1. Location — no point opening the camera if they are off site. */
      let position: Coords | null = null

      // Skip the location step entirely when it would not be acted on, rather
      // than prompting for a permission we are going to ignore.
      if (needsLocation && site) {
        setPhase('locating')
        position = await getCurrentPosition()
        checkAborted()
        setCoords(position)

        const fence = checkGeofence(position, {
          latitude: site.latitude!,
          longitude: site.longitude!,
          radius_m: site.radius_m,
        })
        setDistance(fence.distance)
        if (!fence.inside) {
          throw new Error(
            `You are ${formatDistance(fence.distance)} from ${site.name}. Move within the ${site.radius_m} m check-in zone and try again.`,
          )
        }
      }

      /* 2. Camera. */
      setPhase('camera')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })

      if (abortedRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        throw new Aborted()
      }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      /* 3. Models. */
      setPhase('models')
      await loadFaceModels()
      checkAborted()

      /* 4. Frame loop. A flat `while` keeps the whole run in one scope rather
            than a chain of setTimeout callbacks each capturing stale state. */
      setPhase('scanning')
      const deadline = Date.now() + SCAN_TIMEOUT_MS

      for (;;) {
        checkAborted()

        if (Date.now() > deadline) {
          throw new Error(
            'Timed out waiting for a clear face. Check your lighting and try again.',
          )
        }

        const video = videoRef.current
        if (!video) throw new Aborted()

        let frame: Awaited<ReturnType<typeof analyseFrame>> = null
        try {
          // Cheap pass first. The descriptor is only requested once the face is
          // present and large enough, so the expensive model runs rarely.
          const probe = await analyseFrame(video, false)
          frame = probe && probe.box.width >= 110 ? await analyseFrame(video, true) : probe
        } catch {
          // A dropped frame is not fatal — keep looping.
        }
        checkAborted()

        setFaceVisible(Boolean(frame))

        if (!frame) {
          setHint('No face detected — centre yourself in the frame.')
          await sleep(FRAME_INTERVAL_MS)
          continue
        }

        if (frame.box.width < 110) {
          setHint('Move a little closer to the camera.')
          await sleep(FRAME_INTERVAL_MS)
          continue
        }

        setHint(null)

        /* Enrollment: walk the four poses, one template each. */
        if (mode === 'enroll') {
          const target = ENROLL_POSES[wantedPose]

          if (frame.pose !== target) {
            setHint(POSE_PROMPT[target])
            await sleep(FRAME_INTERVAL_MS)
            continue
          }

          if (!frame.descriptor) {
            setHint('Hold that position…')
            await sleep(FRAME_INTERVAL_MS)
            continue
          }

          captured.push(Array.from(frame.descriptor))
          samples.push(frame.descriptor)
          wantedPose += 1
          setSamplesTaken(captured.length)
          setProgress(captured.length / ENROLL_POSES.length)

          if (wantedPose < ENROLL_POSES.length) {
            setHint(POSE_PROMPT[ENROLL_POSES[wantedPose]])
            // Brief pause so they can move before the next pose is sampled.
            await sleep(600)
            continue
          }

          setPhase('capturing')
          const selfie = await captureFrame(video)
          await finish({
            templates: captured,
            descriptor: captured[0],
            selfie,
            coords: position ?? ZERO_COORDS,
            liveness: 'blink',
            workMode,
          })
          return
        }

        /* verify and checkout both: match the template, then require a blink. */
        if (!frame.descriptor) {
          setHint('Hold still while we read your face…')
          await sleep(FRAME_INTERVAL_MS)
          continue
        }

        if (enrolledDescriptor && enrolledDescriptor.length > 0) {
          const result = matchDescriptor(frame.descriptor, enrolledDescriptor)
          if (!result.matched) {
            setHint('Face not recognised yet — face the camera in even lighting.')
            await sleep(FRAME_INTERVAL_MS)
            continue
          }
        }

        setPhase('blink')
        const didBlink = liveness.push(frame.blink)
        setBlinked(didBlink)
        setProgress(didBlink ? 1 : 0.5)

        if (!didBlink) {
          await sleep(FRAME_INTERVAL_MS)
          continue
        }

        setPhase('capturing')
        const selfie = await captureFrame(video)
        await finish({
          descriptor: Array.from(frame.descriptor),
          selfie,
          coords: position ?? ZERO_COORDS,
          liveness: 'blink',
          workMode,
        })
        return
      }
    } catch (err) {
      stopCamera()
      if (err instanceof Aborted) return

      setError(toMessage(err))
      setPhase('error')
    }

    async function finish(payload: CheckInPayload) {
      stopCamera()
      setPhase('submitting')

      const result = await onSubmitRef.current(payload)
      if (abortedRef.current) return

      if (result.ok) {
        setPhase('done')
      } else {
        setError(result.error ?? 'The server rejected the request.')
        setPhase('error')
      }
    }
  }, [mode, site, needsLocation, workMode, enrolledDescriptor, stopCamera])

  const cancel = useCallback(() => {
    abortedRef.current = true
    stopCamera()
    onCancel()
  }, [onCancel, stopCamera])

  const busy = phase !== 'idle' && phase !== 'error' && phase !== 'done'
  const showVideo = ['camera', 'models', 'scanning', 'blink', 'capturing'].includes(phase)

  return (
    <div className="space-y-4">
      {mode === 'verify' && workModes.length > 1 && (
        <fieldset disabled={busy}>
          <legend className="label">Where are you working today?</legend>
          <div className="grid grid-cols-2 gap-2">
            {workModes.map((option) => {
              const meta = workModeMeta[option]
              const Icon = option === 'remote' ? Home : Building2
              const active = workMode === option
              return (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors"
                  style={{
                    borderColor: active ? meta.color : 'var(--border)',
                    background: active
                      ? `color-mix(in srgb, ${meta.color} 10%, transparent)`
                      : 'transparent',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <input
                    type="radio"
                    name="checkinWorkMode"
                    value={option}
                    checked={active}
                    onChange={() => setWorkMode(option)}
                    className="sr-only"
                  />
                  <Icon
                    size={15}
                    className="shrink-0"
                    style={{ color: active ? meta.color : 'var(--text-muted)' }}
                  />
                  <span
                    className="font-medium"
                    style={{ color: active ? meta.color : 'var(--text)' }}
                  >
                    {meta.label}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )}

      {mode === 'verify' && site && (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm">
          <MapPin size={15} className="shrink-0" style={{ color: 'var(--primary)' }} />
          <span className="min-w-0 flex-1 truncate">{site.name}</span>
          <span className="muted shrink-0 text-xs tabular-nums">
            {!needsLocation
              ? workModeMeta[workMode].label
              : distance === null
                ? `${site.radius_m} m zone`
                : formatDistance(distance)}
          </span>
        </div>
      )}

      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[var(--surface-3)]">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Camera preview"
          className={`h-full w-full scale-x-[-1] object-cover transition-opacity duration-300 ${
            showVideo ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {showVideo && (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
            <motion.div
              animate={{
                borderColor: faceVisible ? 'var(--success)' : 'rgba(255,255,255,0.4)',
                scale: faceVisible ? 1 : 0.97,
              }}
              transition={{ duration: 0.25 }}
              className="h-[68%] w-[52%] rounded-[50%] border-[3px] border-dashed"
            />
          </div>
        )}

        <AnimatePresence>
          {!showVideo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 grid place-items-center px-6 text-center"
            >
              {phase === 'done' ? (
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                  className="flex flex-col items-center gap-2"
                >
                  <CheckCircle2 size={48} style={{ color: 'var(--success)' }} />
                  <p className="font-semibold">
                    {mode === 'enroll'
                      ? 'Face registered'
                      : mode === 'checkout'
                        ? 'Checked out'
                        : 'Checked in'}
                  </p>
                </motion.div>
              ) : phase === 'error' ? (
                <TriangleAlert size={40} style={{ color: 'var(--danger)' }} />
              ) : phase === 'locating' || phase === 'submitting' ? (
                <div className="flex flex-col items-center gap-3">
                  <Spinner size={28} />
                  <p className="muted text-sm">{PHASE_COPY[phase]}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <ScanFace size={44} className="muted opacity-40" />
                  <p className="muted text-sm">
                    {mode === 'enroll'
                      ? 'We will capture a few frames to build your face template. You only get to register once.'
                      : mode === 'checkout'
                        ? 'Verify your face to clock off. This is the same check as check-in.'
                        : needsLocation
                          ? 'Your face and location are both checked before attendance is recorded.'
                          : 'Your face is verified before attendance is recorded. This mode is not location-restricted.'}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {phase === 'blink' && !blinked && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-lg bg-slate-900/80 px-3 py-2 text-sm font-medium text-white backdrop-blur"
            >
              <motion.span
                animate={{ scaleY: [1, 0.15, 1] }}
                transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 0.5 }}
                className="inline-flex"
              >
                <Eye size={16} />
              </motion.span>
              Blink once
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {busy && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="muted">{PHASE_COPY[phase]}</span>
            {mode === 'enroll' && phase === 'scanning' && (
              <span className="muted text-xs tabular-nums">
                {samplesTaken}/{ENROLL_POSES.length} poses
              </span>
            )}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'var(--primary)' }}
              animate={{ width: `${Math.max(8, progress * 100)}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      )}

      {hint && busy && <Alert tone="info">{hint}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {phase === 'idle' && (
        <p className="muted flex items-start gap-2 text-xs">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          Your face is stored as a numeric template, not a photograph. The check-in selfie
          is kept privately for audit and is visible only to you and HR.
        </p>
      )}

      <div className="flex gap-2">
        {phase === 'done' ? (
          <button onClick={cancel} className="btn btn-primary flex-1">
            Close
          </button>
        ) : (
          <>
            <button onClick={cancel} className="btn btn-ghost flex-1">
              Cancel
            </button>
            <button onClick={start} disabled={busy} className="btn btn-primary flex-1">
              {busy ? (
                <Spinner size={16} />
              ) : (
                <>
                  <Camera size={16} />
                  {phase === 'error'
                    ? 'Try again'
                    : mode === 'enroll'
                      ? 'Start enrollment'
                      : 'Check in'}
                </>
              )}
            </button>
          </>
        )}
      </div>

      {coords && phase !== 'idle' && (
        <p className="muted text-center text-[11px] tabular-nums">
          GPS ±{Math.round(coords.accuracy)} m
        </p>
      )}
    </div>
  )
}

const ZERO_COORDS: Coords = { latitude: 0, longitude: 0, accuracy: 0 }

function toMessage(err: unknown): string {
  if (err instanceof GeolocationFailure) return err.message

  if (err instanceof Error) {
    switch (err.name) {
      case 'NotAllowedError':
        return 'Camera access was blocked. Allow it in your browser settings, then retry.'
      case 'NotFoundError':
        return 'No camera was found on this device.'
      case 'NotReadableError':
        return 'The camera is already in use by another app.'
      default:
        return err.message
    }
  }
  return 'Something went wrong. Please try again.'
}
