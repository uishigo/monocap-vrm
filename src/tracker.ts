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

// GPU delegate がクラッシュした場合を sessionStorage で検出する
// ページロード前に 'gpu-init' フラグをセット → 正常完了したら削除
// 次回ロード時にフラグが残っていたら前回クラッシュと判断して CPU へフォールバック
const GPU_CRASH_KEY = 'mediapipe-gpu-crashed'

function chooseDelegate(): 'GPU' | 'CPU' {
  if (sessionStorage.getItem(GPU_CRASH_KEY)) {
    console.warn('MediaPipe: GPU delegate が前回クラッシュしたため CPU を使用します')
    return 'CPU'
  }
  return 'GPU'
}

async function tryCreateLandmarkers(
  vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  delegate: 'GPU' | 'CPU',
) {
  if (delegate === 'GPU') {
    sessionStorage.setItem(GPU_CRASH_KEY, '1')
  }

  const result = await Promise.all([
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

  // 正常に初期化できたらクラッシュフラグを削除
  sessionStorage.removeItem(GPU_CRASH_KEY)
  return result
}

export async function createTracker(): Promise<Tracker> {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  let delegate = chooseDelegate()
  let faceLandmarker: FaceLandmarker
  let poseLandmarker: PoseLandmarker

  try {
    ;[faceLandmarker, poseLandmarker] = await tryCreateLandmarkers(vision, delegate)
    console.log(`MediaPipe: ${delegate} delegate で初期化成功`)
  } catch (e) {
    if (delegate === 'GPU') {
      console.warn('MediaPipe: GPU delegate の初期化失敗、CPU にフォールバック:', e)
      sessionStorage.removeItem(GPU_CRASH_KEY)
      delegate = 'CPU'
      ;[faceLandmarker, poseLandmarker] = await tryCreateLandmarkers(vision, 'CPU')
      console.log('MediaPipe: CPU delegate で初期化成功')
    } else {
      throw e
    }
  }

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
