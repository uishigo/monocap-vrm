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

export async function createTracker(): Promise<Tracker> {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  const delegate = 'GPU'

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
