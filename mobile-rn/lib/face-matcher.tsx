import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

/**
 * Computes face-api descriptors, once per app session.
 *
 * WHY A WEBVIEW, WHEN THE APP IS OTHERWISE FULLY NATIVE
 *
 * The enrolled templates in `employees.face_descriptor` were produced by
 * `@vladmandic/face-api`. A descriptor is only comparable to others from the
 * *same* pipeline — a MobileFaceNet or ML Kit embedding is not a worse match
 * against those templates, it is a meaningless one, because the numbers are not
 * in the same space. So there are exactly three ways to verify a face here:
 *
 *   1. Re-enrol all ~600 employees against a new on-device model.
 *   2. Compute the descriptor server-side. face-api under Node requires
 *      @tensorflow/tfjs-node, a native module that is fragile on serverless —
 *      verified by trying it: the import fails with
 *      "Cannot find module '@tensorflow/tfjs-node'".
 *   3. Run face-api's own JavaScript, which is what this does.
 *
 * (3) is the only option that produces *identical* descriptors to the web,
 * because it is literally the same code and the same weights.
 *
 * This is NOT a WebView wrapper. It renders 1x1 and off-screen, with no
 * navigation and no chrome. Every pixel the user sees is native. It is an
 * offscreen JS sandbox that happens to be the only place this model can run.
 *
 * WHY IT LIVES AT THE ROOT
 *
 * Mounted inside a screen, it unmounted and reloaded on every tab change —
 * TabBar navigates with router.replace() — so the weights were re-parsed and
 * re-uploaded to the GPU each time. Mounted once here it is warm long before
 * anyone reaches the camera, which is the difference between a check-in that
 * feels instant and one that stalls for several seconds on the shutter.
 */

export type FaceResult =
  | { ok: true; descriptor: number[] }
  | {
      ok: false
      reason: 'no-face' | 'many-faces' | 'load-failed' | 'timeout' | 'error'
      message: string
    }

export type MatcherStatus = 'loading' | 'ready' | 'failed'

type Ctx = {
  status: MatcherStatus
  /** Compute a descriptor for a base64 JPEG. Never rejects — failures come back as ok:false. */
  describe: (base64Jpeg: string) => Promise<FaceResult>
  /** Retry after a load failure (no network at launch, say). */
  retry: () => void
}

const MatcherContext = createContext<Ctx | null>(null)

/** One still should never take this long, even on a cold mid-range Android. */
const DESCRIBE_TIMEOUT_MS = 30_000

/**
 * The page. Kept as a string rather than a bundled asset so the models origin
 * can be injected per build, and so there is no second place to keep in step.
 *
 * The detector and its options MUST stay identical to the web's — see
 * frontend/src/lib/face.ts. The detector picks the box, the box picks the
 * aligned crop, and the crop picks the 128 floats. A different detector does
 * not merely lose a little accuracy; it shifts every descriptor away from the
 * templates employees actually enrolled against.
 */
function page(modelsOrigin: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /></head><body>
<script>
  // Queue shim, defined BEFORE the 1.3MB face-api script is fetched. Without
  // it, a describe() injected during load hits an undefined function, the
  // ReferenceError is swallowed by injectJavaScript, nothing is ever posted
  // back, and the caller waits forever.
  window.__q = []
  window.__describe = function () { window.__q.push(arguments) }
</script>
<script src="${modelsOrigin}/models/face-api.js"></script>
<script>
  var MODELS = '${modelsOrigin}/models'
  var ready = false
  var loading = null

  function post(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg))
  }

  function load() {
    if (loading) return loading
    loading = (async function () {
      // Exactly the three nets the web loads. tinyFaceDetector is 196KB against
      // ssdMobilenetv1's 5.4MB, and it is what enrolment used — so this is both
      // the correct choice and by far the cheaper one.
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS)
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS)
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS)
      ready = true
      var backend = ''
      try { backend = faceapi.tf.getBackend() } catch (e) { backend = 'unknown' }
      post({ type: 'ready', backend: backend })
      var queued = window.__q || []
      window.__q = []
      for (var i = 0; i < queued.length; i++) {
        describe.apply(null, queued[i])
      }
    })()
    loading.catch(function (e) {
      loading = null
      post({ type: 'failed', message: String((e && e.message) || e) })
    })
    return loading
  }

  async function describe(id, dataUrl) {
    try {
      if (!ready) {
        await load()
        // load() failed and already reported it; do not fall through and run
        // detection against nets that were never loaded.
        if (!ready) return
      }

      var img = new Image()
      img.src = dataUrl
      await new Promise(function (res, rej) { img.onload = res; img.onerror = rej })

      // Same options as frontend/src/lib/face.ts. detectAllFaces rather than
      // detectSingleFace because two faces in frame is a different failure from
      // none, and the user needs telling which.
      var found = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }))
        .withFaceLandmarks()
        .withFaceDescriptors()

      if (!found.length) return post({ type: 'result', id: id, ok: false, reason: 'no-face', message: 'No face detected.' })
      if (found.length > 1) return post({ type: 'result', id: id, ok: false, reason: 'many-faces', message: 'More than one face in frame.' })

      post({ type: 'result', id: id, ok: true, descriptor: Array.from(found[0].descriptor) })
    } catch (e) {
      post({ type: 'result', id: id, ok: false, reason: 'error', message: String((e && e.message) || e) })
    }
  }

  // Drain anything queued against the shim, then take over.
  var pending = window.__q || []
  window.__q = []
  window.__describe = describe
  load()
  for (var i = 0; i < pending.length; i++) describe.apply(null, pending[i])
</script>
</body></html>`
}

export function FaceMatcherProvider({
  modelsOrigin,
  children,
}: {
  modelsOrigin: string
  children: ReactNode
}) {
  const webRef = useRef<WebView>(null)
  const [status, setStatus] = useState<MatcherStatus>('loading')
  // Bumped to force a fresh WebView on retry — reloading in place would keep
  // whatever broken tf state caused the failure.
  const [generation, setGeneration] = useState(0)

  const nextId = useRef(0)
  const pending = useRef(
    new Map<number, { resolve: (r: FaceResult) => void; timer: ReturnType<typeof setTimeout> }>(),
  )

  const settle = useCallback((id: number, result: FaceResult) => {
    const entry = pending.current.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.current.delete(id)
    entry.resolve(result)
  }, [])

  // A failed load can never produce a descriptor, so anything waiting is
  // already doomed — release it now rather than at the timeout.
  const failAll = useCallback(
    (message: string) => {
      for (const id of Array.from(pending.current.keys())) {
        settle(id, { ok: false, reason: 'load-failed', message })
      }
    },
    [settle],
  )

  useEffect(() => {
    const inFlight = pending.current
    return () => {
      for (const { timer } of inFlight.values()) clearTimeout(timer)
      inFlight.clear()
    }
  }, [])

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: {
        type?: string
        id?: number
        ok?: boolean
        descriptor?: number[]
        reason?: FaceResult extends { ok: false; reason: infer R } ? R : never
        message?: string
        backend?: string
      }
      try {
        msg = JSON.parse(event.nativeEvent.data)
      } catch {
        return
      }

      if (msg.type === 'ready') {
        if (__DEV__) console.log(`[face] models ready, tf backend: ${msg.backend}`)
        setStatus('ready')
        return
      }
      if (msg.type === 'failed') {
        setStatus('failed')
        failAll(msg.message ?? 'The face models could not be loaded.')
        return
      }
      if (msg.type !== 'result' || typeof msg.id !== 'number') return

      settle(
        msg.id,
        msg.ok
          ? { ok: true, descriptor: msg.descriptor ?? [] }
          : {
              ok: false,
              reason: msg.reason ?? 'error',
              message: msg.message ?? 'The face could not be read.',
            },
      )
    },
    [failAll, settle],
  )

  const describe = useCallback((base64Jpeg: string) => {
    const id = ++nextId.current
    const dataUrl = `data:image/jpeg;base64,${base64Jpeg}`

    return new Promise<FaceResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.current.delete(id)
        resolve({
          ok: false,
          reason: 'timeout',
          message: 'Reading your face took too long. Check your connection and try again.',
        })
      }, DESCRIBE_TIMEOUT_MS)

      pending.current.set(id, { resolve, timer })
      webRef.current?.injectJavaScript(
        `window.__describe(${id}, ${JSON.stringify(dataUrl)}); true;`,
      )
    })
  }, [])

  const retry = useCallback(() => {
    setStatus('loading')
    setGeneration((g) => g + 1)
  }, [])

  const value = useMemo<Ctx>(() => ({ status, describe, retry }), [status, describe, retry])

  return (
    <MatcherContext.Provider value={value}>
      {children}
      <View style={styles.hidden} pointerEvents="none">
        <WebView
          key={generation}
          ref={webRef}
          source={{ html: page(modelsOrigin), baseUrl: modelsOrigin }}
          onMessage={onMessage}
          onError={() => {
            setStatus('failed')
            failAll('The face models could not be reached.')
          }}
          onHttpError={() => {
            setStatus('failed')
            failAll('The face models could not be downloaded.')
          }}
          javaScriptEnabled
          domStorageEnabled
          // The page is generated here and loads only our own origin; nothing
          // navigates, so there is no third-party script to sandbox against.
          originWhitelist={[modelsOrigin]}
          // No androidLayerType="software": it forces a software layer, which
          // takes WebGL with it and drops tfjs onto the plain CPU kernel.
          cacheEnabled
        />
      </View>
    </MatcherContext.Provider>
  )
}

/**
 * User-facing copy for a failed read.
 *
 * Each reason gets its own sentence because they need different actions from
 * the user: move into light, step away from whoever is behind you, or check
 * the network. A single generic "face check failed" leaves them retrying the
 * thing that cannot work.
 */
export function faceErrorText(result: Extract<FaceResult, { ok: false }>): string {
  switch (result.reason) {
    case 'no-face':
      return 'No face detected. Move into better light, hold the phone at eye level, and try again.'
    case 'many-faces':
      return 'More than one face in the photo. Step away from anyone behind you and try again.'
    case 'timeout':
      return result.message
    case 'load-failed':
      return 'The face models could not be loaded. Check your connection and try again.'
    default:
      return `Could not read your face: ${result.message}`
  }
}

export function useFaceMatcher(): Ctx {
  const ctx = useContext(MatcherContext)
  if (!ctx) throw new Error('useFaceMatcher must be used inside FaceMatcherProvider')
  return ctx
}

const styles = StyleSheet.create({
  // Off-screen and effectively invisible, but NOT 0x0: a zero-area view can be
  // denied a hardware surface, which is the thing that keeps WebGL available.
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, top: -1000, left: -1000 },
})
