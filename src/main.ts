import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { createRenderer, loadVRM } from './renderer'
import { createTracker } from './tracker'
import type { Tracker } from './tracker'
import { applyTracking } from './rigger'
import { startCamera, stopCamera } from './camera'
import type { FpsCounter } from './types'

const video       = document.getElementById('camera-video')    as HTMLVideoElement
const canvas      = document.getElementById('vrm-canvas')      as HTMLCanvasElement
const statusEl    = document.getElementById('status')          as HTMLSpanElement
const fpsEl       = document.getElementById('fps')             as HTMLSpanElement
const btnCamera   = document.getElementById('btn-camera')      as HTMLButtonElement
const btnLoadVrm  = document.getElementById('btn-load-vrm')    as HTMLButtonElement
const btnCapture  = document.getElementById('btn-capture')     as HTMLButtonElement
const vrmFileInput = document.getElementById('vrm-file-input') as HTMLInputElement

let vrm: VRM | null = null
let tracker: Tracker | null = null
let isTracking = false

const fps: FpsCounter = { value: 0, lastTime: performance.now(), frameCount: 0 }

function setStatus(text: string, type: 'ready' | 'loading' | 'error') {
  statusEl.textContent = text
  statusEl.className = type
}

const { renderer, scene, camera } = createRenderer(canvas)

function tick(delta: number) {
  if (vrm) vrm.update(delta)

  renderer.render(scene, camera)

  if (isTracking && tracker && video.readyState === 4) {
    try {
      const { face, pose } = tracker.detect(video)
      if (vrm) applyTracking(vrm, face, pose)
    } catch (e) {
      console.warn('tracking error:', e)
    }
  }

  fps.frameCount++
  const now = performance.now()
  if (now - fps.lastTime >= 1000) {
    fps.value = fps.frameCount
    fps.frameCount = 0
    fps.lastTime = now
    fpsEl.textContent = `${fps.value} fps`
  }
}

let prevTime = performance.now()
function loop() {
  requestAnimationFrame(loop)
  const now = performance.now()
  tick((now - prevTime) / 1000)
  prevTime = now
}

async function initTracker() {
  if (tracker) return
  setStatus('AIモデル読み込み中...', 'loading')
  try {
    tracker = await createTracker()
    setStatus('準備完了', 'ready')
  } catch (e) {
    setStatus('AIモデル読み込み失敗', 'error')
    console.error(e)
  }
}

btnCamera.addEventListener('click', async () => {
  if (isTracking) {
    isTracking = false
    stopCamera(video)
    btnCamera.textContent = 'カメラ開始'
    setStatus(vrm ? '準備完了' : 'VRM未読み込み', 'ready')
    return
  }

  try {
    setStatus('カメラ起動中...', 'loading')
    await startCamera(video)
    await initTracker()
    isTracking = true
    btnCamera.textContent = 'カメラ停止'
    setStatus('トラッキング中', 'ready')
  } catch (e) {
    setStatus('カメラアクセス失敗', 'error')
    console.error(e)
  }
})

btnLoadVrm.addEventListener('click', () => vrmFileInput.click())

vrmFileInput.addEventListener('change', async () => {
  const file = vrmFileInput.files?.[0]
  if (!file) return

  setStatus('VRM 読み込み中...', 'loading')
  const url = URL.createObjectURL(file)
  try {
    if (vrm) {
      scene.remove(vrm.scene)
      vrm.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
      })
    }
    vrm = await loadVRM(scene, url)
    btnCapture.disabled = false
    setStatus('準備完了', 'ready')
  } catch (e) {
    setStatus('VRM 読み込み失敗', 'error')
    console.error(e)
  } finally {
    URL.revokeObjectURL(url)
    vrmFileInput.value = ''
  }
})

btnCapture.addEventListener('click', () => {
  renderer.render(scene, camera)
  const link = document.createElement('a')
  link.download = `monocap-${Date.now()}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
})

setStatus('VRM を読み込んでください', 'loading')
loop()
