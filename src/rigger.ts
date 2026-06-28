import * as THREE from 'three'
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm'
import { Face, Pose, type TFace, type TPose } from 'kalidokit'
import type { FaceLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision'

const LERP = 0.3
const DEG = Math.PI / 180

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function lerpEuler(bone: THREE.Object3D, target: { x: number; y: number; z: number }) {
  if (!isFinite(target.x) || !isFinite(target.y) || !isFinite(target.z)) return
  bone.rotation.x = lerp(bone.rotation.x, target.x, LERP)
  bone.rotation.y = lerp(bone.rotation.y, target.y, LERP)
  bone.rotation.z = lerp(bone.rotation.z, target.z, LERP)
}

function mediapipeFaceToKalido(result: FaceLandmarkerResult): TFace | null {
  if (!result.faceLandmarks?.length || !result.facialTransformationMatrixes?.length) return null

  const landmarks = result.faceLandmarks[0].map((lm) => ({ x: lm.x, y: lm.y, z: lm.z ?? 0 }))

  return Face.solve(landmarks, {
    runtime: 'mediapipe',
    imageSize: { width: 640, height: 480 },
    smoothBlink: true,
    blinkSettings: [0.25, 0.75],
  } as any) ?? null
}

function mediapipePoseToKalido(result: PoseLandmarkerResult): TPose | null {
  if (!result.worldLandmarks?.length) return null

  const landmarks = result.worldLandmarks[0].map((lm) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z ?? 0,
    visibility: lm.visibility ?? 0,
  }))

  return Pose.solve(landmarks, landmarks, {
    runtime: 'mediapipe',
    imageSize: { width: 640, height: 480 },
  } as any) ?? null
}

const SHARED_BONES: [VRMHumanBoneName, keyof TPose, number][] = [
  [VRMHumanBoneName.Hips,  'Hips',  1],
  [VRMHumanBoneName.Spine, 'Spine', 0.5],
]

const ARM_BONES_MIRROR: [VRMHumanBoneName, keyof TPose, number][] = [
  [VRMHumanBoneName.LeftUpperArm,  'LeftUpperArm',  1],
  [VRMHumanBoneName.LeftLowerArm,  'LeftLowerArm',  1],
  [VRMHumanBoneName.RightUpperArm, 'RightUpperArm', 1],
  [VRMHumanBoneName.RightLowerArm, 'RightLowerArm', 1],
]

const ARM_BONES_DIRECT: [VRMHumanBoneName, keyof TPose, number][] = [
  [VRMHumanBoneName.LeftUpperArm,  'RightUpperArm', 1],
  [VRMHumanBoneName.LeftLowerArm,  'RightLowerArm', 1],
  [VRMHumanBoneName.RightUpperArm, 'LeftUpperArm',  1],
  [VRMHumanBoneName.RightLowerArm, 'LeftLowerArm',  1],
]

export function applyTracking(vrm: VRM, face: FaceLandmarkerResult | null, pose: PoseLandmarkerResult | null, mirror = true) {
  const humanoid = vrm.humanoid
  const expressionManager = vrm.expressionManager
  const s = mirror ? 1 : -1

  if (face) {
    const faceRig = mediapipeFaceToKalido(face)
    if (faceRig) {
      const head = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)
      const neck = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck)

      if (head) {
        lerpEuler(head, {
          x: faceRig.head.degrees.x * DEG * 0.7,
          y: faceRig.head.degrees.y * DEG * 0.7 * s,
          z: faceRig.head.degrees.z * DEG * 0.7 * s,
        })
      }

      if (neck) {
        lerpEuler(neck, {
          x: faceRig.head.degrees.x * DEG * 0.3,
          y: faceRig.head.degrees.y * DEG * 0.3 * s,
          z: faceRig.head.degrees.z * DEG * 0.3 * s,
        })
      }

      if (expressionManager) {
        expressionManager.setValue('blinkLeft',  lerp(expressionManager.getValue('blinkLeft')  ?? 0, 1 - (faceRig.eye?.l ?? 1), LERP))
        expressionManager.setValue('blinkRight', lerp(expressionManager.getValue('blinkRight') ?? 0, 1 - (faceRig.eye?.r ?? 1), LERP))
        expressionManager.setValue('aa', lerp(expressionManager.getValue('aa') ?? 0, faceRig.mouth?.shape?.A ?? 0, LERP))
        expressionManager.setValue('ih', lerp(expressionManager.getValue('ih') ?? 0, faceRig.mouth?.shape?.I ?? 0, LERP))
        expressionManager.setValue('ou', lerp(expressionManager.getValue('ou') ?? 0, faceRig.mouth?.shape?.U ?? 0, LERP))
        expressionManager.setValue('ee', lerp(expressionManager.getValue('ee') ?? 0, faceRig.mouth?.shape?.E ?? 0, LERP))
        expressionManager.setValue('oh', lerp(expressionManager.getValue('oh') ?? 0, faceRig.mouth?.shape?.O ?? 0, LERP))
      }
    }
  }

  if (pose) {
    const poseRig = mediapipePoseToKalido(pose)
    if (poseRig) {
      const boneMap = [...(mirror ? ARM_BONES_MIRROR : ARM_BONES_DIRECT), ...SHARED_BONES]
      for (const [boneName, rigKey, scale] of boneMap) {
        const bone = humanoid.getNormalizedBoneNode(boneName)
        const rig = poseRig[rigKey] as { x: number; y: number; z: number } | undefined
        if (bone && rig) {
          lerpEuler(bone, {
            x: rig.x * scale,
            y: rig.y * scale * s,
            z: rig.z * scale * s,
          })
        }
      }
    }
  }
}
