import type { VRM } from '@pixiv/three-vrm'

export interface AppState {
  vrm: VRM | null
  isTracking: boolean
}

export interface FpsCounter {
  value: number
  lastTime: number
  frameCount: number
}
