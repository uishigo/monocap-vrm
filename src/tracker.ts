import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision'

export interface TrackingResult {
  face: FaceLandmarkerResult | null
  pose: PoseLandmarkerResult | null
}

export interface Tracker {
  detect(video: HTMLVideoElement): TrackingResult
  close(): void
}

/**
 * WebSocket ベースのリモートトラッカー。
 * JPEG フレームをサーバーに送信し、MediaPipe ランドマーク JSON を受け取る。
 * server/main.py と組み合わせて使用する。
 * URL パラメータ ?server=ws://<host>:8000/ws で有効化。
 */
export async function createRemoteTracker(serverUrl: string): Promise<Tracker> {
  const captureCanvas = document.createElement('canvas')
  captureCanvas.width = 320
  captureCanvas.height = 240
  const captureCtx = captureCanvas.getContext('2d')!

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(serverUrl)

    let lastResult: TrackingResult = { face: null, pose: null }
    let pending = false

    ws.onmessage = (e) => {
      try {
        lastResult = JSON.parse(e.data as string) as unknown as TrackingResult
      } catch {
        // ignore malformed response
      }
      pending = false
    }

    ws.onerror = () => reject(new Error(`サーバー接続失敗: ${serverUrl}`))

    ws.onopen = () =>
      resolve({
        detect(video: HTMLVideoElement): TrackingResult {
          if (!pending && ws.readyState === WebSocket.OPEN) {
            pending = true
            captureCtx.drawImage(video, 0, 0, 320, 240)
            captureCanvas.toBlob(
              (blob) => {
                if (!blob) {
                  pending = false
                  return
                }
                ws.send(blob)
              },
              'image/jpeg',
              0.7,
            )
          }
          return lastResult
        },
        close() {
          ws.close()
        },
      })
  })
}

export async function createTracker(): Promise<Tracker> {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  // スマホでは Three.js と GPU メモリを競合しクラッシュするため CPU 固定
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const delegate = isMobile ? 'CPU' : 'GPU'

  const [faceLandmarker, poseLandmarker] = await Promise.all([
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate,
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    }),
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate,
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    }),
  ])

  let lastFaceTimestamp = -1
  let lastPoseTimestamp = -1
  let lastFace: FaceLandmarkerResult | null = null
  let lastPose: PoseLandmarkerResult | null = null
  let alternate = false

  return {
    detect(video: HTMLVideoElement): TrackingResult {
      const now = performance.now()

      // 顔とポーズを交互に検出し、1フレームあたりのML処理を半減
      if (alternate) {
        if (now !== lastFaceTimestamp) {
          lastFace = faceLandmarker.detectForVideo(video, now)
          lastFaceTimestamp = now
        }
      } else {
        if (now !== lastPoseTimestamp) {
          lastPose = poseLandmarker.detectForVideo(video, now)
          lastPoseTimestamp = now
        }
      }
      alternate = !alternate

      return { face: lastFace, pose: lastPose }
    },

    close() {
      faceLandmarker.close()
      poseLandmarker.close()
    },
  }
}
