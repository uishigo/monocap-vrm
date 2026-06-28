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

  const [faceLandmarker, poseLandmarker] = await Promise.all([
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'CPU',
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
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    }),
  ])

  let lastFaceTimestamp = -1
  let lastPoseTimestamp = -1

  return {
    detect(video: HTMLVideoElement): TrackingResult {
      const now = performance.now()

      let face: FaceLandmarkerResult | null = null
      let pose: PoseLandmarkerResult | null = null

      if (now !== lastFaceTimestamp) {
        face = faceLandmarker.detectForVideo(video, now)
        lastFaceTimestamp = now
      }

      if (now !== lastPoseTimestamp) {
        pose = poseLandmarker.detectForVideo(video, now)
        lastPoseTimestamp = now
      }

      return { face, pose }
    },

    close() {
      faceLandmarker.close()
      poseLandmarker.close()
    },
  }
}
