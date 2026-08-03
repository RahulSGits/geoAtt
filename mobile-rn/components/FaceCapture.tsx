import { useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImageManipulator from 'expo-image-manipulator'

import { useTheme } from '../lib/scheme'
import { radius, type Palette } from '../lib/theme'

/**
 * Front-camera capture for check-in.
 *
 * WHAT THIS DOES AND DOES NOT DO
 *
 * It captures a selfie and hands back JPEG bytes. It does **not** compute a
 * face descriptor or decide whether the face matches — that comparison needs
 * the same `face-api` `faceRecognitionNet` that produced the enrolled
 * templates, and no React Native library produces vectors comparable to them.
 * A different model would not be "close enough"; the numbers are not in the
 * same space, so every comparison would be meaningless rather than merely
 * inaccurate.
 *
 * So the selfie is evidence, not authentication: it goes to the private
 * attendance-selfies bucket against the check-in, where HR can review it, and
 * it is the input a server-side match endpoint would need when one exists.
 * Calling it verification here would be worse than not having it.
 *
 * The image is downscaled to 640px before upload. A modern phone camera
 * produces 3–8 MB per frame; at 600 employees checking in daily that is
 * gigabytes a month of storage for something a face model reads at a fraction
 * of the resolution, and it is a slow upload on the mobile data people
 * actually check in on.
 */
type Props = {
  visible: boolean
  onCancel: () => void
  onCaptured: (jpeg: { uri: string; base64: string }) => void
}

export default function FaceCapture({ visible, onCancel, onCaptured }: Props) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const cameraRef = useRef<CameraView>(null)
  const [permission, requestPermission] = useCameraPermissions()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function capture() {
    if (!cameraRef.current || busy) return
    setBusy(true)
    setError(null)
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.8 })
      if (!shot?.uri) throw new Error('The camera returned no image.')

      const resized = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: 640 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      )
      if (!resized.base64) throw new Error('Could not encode the photo.')

      onCaptured({ uri: resized.uri, base64: resized.base64 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take the photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root}>
        {!permission ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : !permission.granted ? (
          <View style={styles.centre}>
            <Text style={styles.title}>Camera access needed</Text>
            <Text style={styles.body}>
              A photo is taken at check-in so your attendance can be reviewed. It is stored
              privately and visible only to you and HR.
            </Text>
            <Pressable onPress={requestPermission} style={styles.cta} accessibilityRole="button">
              <Text style={styles.ctaText}>ALLOW CAMERA</Text>
            </Pressable>
            <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button">
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />

            {/* Framing guide. Purely an aiming aid — nothing detects a face. */}
            <View pointerEvents="none" style={styles.guideWrap}>
              <View style={styles.guide} />
              <Text style={styles.guideText}>Centre your face in the circle</Text>
            </View>

            <View style={styles.controls}>
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                onPress={capture}
                disabled={busy}
                style={[styles.shutter, busy && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="Take photo"
                accessibilityState={{ disabled: busy, busy }}
              >
                {busy ? <ActivityIndicator color={colors.brand} /> : <View style={styles.shutterInner} />}
              </Pressable>
              <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button">
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  )
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.bg },
    title: { color: colors.ink, fontSize: 19, fontWeight: '700' },
    body: {
      marginTop: 10,
      color: colors.inkMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    cta: {
      marginTop: 22,
      paddingHorizontal: 26,
      height: 46,
      borderRadius: radius.pill,
      backgroundColor: colors.brand,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaText: { color: colors.onBrand, fontSize: 13.5, fontWeight: '700', letterSpacing: 1 },
    link: { marginTop: 16, color: colors.inkMuted, fontSize: 13.5, fontWeight: '600' },

    guideWrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    guide: {
      width: 240,
      height: 300,
      borderRadius: 150,
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.85)',
    },
    guideText: {
      marginTop: 18,
      color: 'rgba(255,255,255,0.9)',
      fontSize: 14,
      fontWeight: '600',
    },

    controls: { position: 'absolute', left: 0, right: 0, bottom: 44, alignItems: 'center', gap: 14 },
    shutter: {
      width: 74,
      height: 74,
      borderRadius: 37,
      backgroundColor: 'rgba(255,255,255,0.25)',
      borderWidth: 4,
      borderColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
    cancel: { color: '#fff', fontSize: 14, fontWeight: '600' },
    error: {
      color: '#fff',
      backgroundColor: 'rgba(185,28,28,0.9)',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.field,
      fontSize: 12.5,
      marginHorizontal: 24,
      textAlign: 'center',
    },
  })
