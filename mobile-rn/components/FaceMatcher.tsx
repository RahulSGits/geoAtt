import { forwardRef, useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

/**
 * Computes a face-api descriptor for a captured photo.
 *
 * WHY A WEBVIEW, WHEN THE APP IS OTHERWISE FULLY NATIVE
 *
 * The enrolled templates in `employees.face_descriptor` were produced by
 * `@vladmandic/face-api`'s `faceRecognitionNet`. A descriptor is only
 * comparable to others from the *same* model — a MobileFaceNet or OpenCV
 * embedding is not a worse match against those templates, it is a meaningless
 * one, because the numbers are not in the same space. So there are exactly
 * three ways to verify a face on mobile:
 *
 *   1. Re-enrol all 600 employees against a new on-device model.
 *   2. Compute the descriptor server-side. face-api under Node requires
 *      @tensorflow/tfjs-node, a native module that is fragile on serverless —
 *      verified by trying it: the import fails with
 *      "Cannot find module '@tensorflow/tfjs-node'".
 *   3. Run face-api's own JavaScript, which is what this does.
 *
 * (3) is the only option that produces *identical* descriptors to the web,
 * because it is literally the same code and the same weights. Nobody re-enrols
 * and there is one identity model across both platforms.
 *
 * This is NOT a WebView wrapper. It renders nothing — zero by zero, off-screen,
 * no navigation, no chrome. Every pixel the user sees is native. It is an
 * offscreen JS sandbox that happens to be the only place this model can run.
 *
 * The weights load from the deployed site's /models, which is already public
 * and served immutable, so there is nothing extra to ship in the bundle.
 */

export type FaceResult =
  | { ok: true; descriptor: number[] }
  | { ok: false; reason: 'no-face' | 'many-faces' | 'load-failed' | 'error'; message: string }

type Props = {
  /** Origin serving /models — the deployed web app. */
  modelsOrigin: string
  onResult: (result: FaceResult) => void
}

export type FaceMatcherHandle = {
  /** Compute a descriptor for a base64 JPEG. Result arrives via onResult. */
  describe: (base64Jpeg: string) => void
}

/**
 * The page. Kept as a string rather than a bundled asset so the models origin
 * can be injected per build, and so there is no second place to keep in step.
 */
function page(modelsOrigin: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /></head><body>
<script src="${modelsOrigin}/models/face-api.js"></script>
<script>
  var MODELS = '${modelsOrigin}/models'
  var ready = false

  function post(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg))
  }

  async function load() {
    try {
      // The same three nets the web check-in uses: a detector, the 68-point
      // landmarks the recogniser aligns on, and the recogniser itself.
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS)
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS)
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS)
      ready = true
      post({ type: 'ready' })
    } catch (e) {
      post({ type: 'result', ok: false, reason: 'load-failed', message: String(e && e.message || e) })
    }
  }

  async function describe(dataUrl) {
    try {
      if (!ready) { await load() }
      var img = new Image()
      img.src = dataUrl
      await new Promise(function (res, rej) { img.onload = res; img.onerror = rej })

      // detectAllFaces, not detectSingleFace: two faces in frame is a
      // different failure from none, and the user needs telling which.
      var found = await faceapi
        .detectAllFaces(img)
        .withFaceLandmarks()
        .withFaceDescriptors()

      if (!found.length) return post({ type: 'result', ok: false, reason: 'no-face', message: 'No face detected.' })
      if (found.length > 1) return post({ type: 'result', ok: false, reason: 'many-faces', message: 'More than one face in frame.' })

      post({ type: 'result', ok: true, descriptor: Array.from(found[0].descriptor) })
    } catch (e) {
      post({ type: 'result', ok: false, reason: 'error', message: String(e && e.message || e) })
    }
  }

  window.__describe = describe
  load()
</script>
</body></html>`
}

/**
 * forwardRef because the parent drives it: describeWith() injects the call on
 * demand rather than the component owning a queue of pending images. One
 * matcher, many captures.
 */
const FaceMatcher = forwardRef<WebView, Props>(function FaceMatcher(
  { modelsOrigin, onResult },
  ref,
) {
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data)
        if (msg.type !== 'result') return
        onResult(
          msg.ok
            ? { ok: true, descriptor: msg.descriptor }
            : { ok: false, reason: msg.reason, message: msg.message },
        )
      } catch {
        onResult({ ok: false, reason: 'error', message: 'Unreadable response from the matcher.' })
      }
    },
    [onResult],
  )

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref as React.Ref<WebView>}
        source={{ html: page(modelsOrigin), baseUrl: modelsOrigin }}
        onMessage={handleMessage}
        javaScriptEnabled
        // The page is generated here and loads only our own origin; nothing
        // navigates, so there is no third-party script to sandbox against.
        originWhitelist={[modelsOrigin]}
        androidLayerType="software"
      />
    </View>
  )
})

export default FaceMatcher

/** Attach a describe() call to a WebView ref from the parent. */
export function describeWith(ref: React.RefObject<WebView | null>, base64Jpeg: string) {
  const dataUrl = `data:image/jpeg;base64,${base64Jpeg}`
  ref.current?.injectJavaScript(`window.__describe(${JSON.stringify(dataUrl)}); true;`)
}

const styles = StyleSheet.create({
  // Zero-sized and off-screen. It renders nothing; it is a compute surface.
  hidden: { position: 'absolute', width: 0, height: 0, opacity: 0, top: -1000, left: -1000 },
})
