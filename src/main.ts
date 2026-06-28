import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { createRenderer, loadVRM } from './renderer'
import { createTracker } from './tracker'
import type { Tracker, TrackingResult } from './tracker'
import { applyTracking } from './rigger'
import { startCamera, stopCamera } from './camera'
import type { FpsCounter } from './types'

const video           = document.getElementById('camera-video')    as HTMLVideoElement
const canvas          = document.getElementById('vrm-canvas')      as HTMLCanvasElement
const previewCanvas   = document.getElementById('preview-canvas')  as HTMLCanvasElement
const statusEl        = document.getElementById('status')          as HTMLSpanElement
const fpsEl           = document.getElementById('fps')             as HTMLSpanElement
const btnCamera       = document.getElementById('btn-camera')      as HTMLButtonElement
const btnLoadVrm      = document.getElementById('btn-load-vrm')    as HTMLButtonElement
const btnCapture      = document.getElementById('btn-capture')     as HTMLButtonElement
const btnResetView    = document.getElementById('btn-reset-view')  as HTMLButtonElement
const btnViewCamera   = document.getElementById('btn-view-camera') as HTMLButtonElement
const btnViewSkeleton = document.getElementById('btn-view-skeleton') as HTMLButtonElement
const vrmFileInput    = document.getElementById('vrm-file-input')  as HTMLInputElement

let vrm: VRM | null = null
let tracker: Tracker | null = null
let isTracking = false
let showCamera = false
let showSkeleton = false
let lastTrackingResult: TrackingResult | null = null

const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32],
]

function updateView() {
  video.style.visibility = showCamera ? 'visible' : 'hidden'
  previewCanvas.style.display = showSkeleton ? 'block' : 'none'
  btnViewCamera.classList.toggle('active', showCamera)
  btnViewSkeleton.classList.toggle('active', showSkeleton)
}

function drawSkeleton(result: TrackingResult | null) {
  const ctx = previewCanvas.getContext('2d')
  if (!ctx) return

  const w = previewCanvas.clientWidth
  const h = previewCanvas.clientHeight
  if (previewCanvas.width !== w || previewCanvas.height !== h) {
    previewCanvas.width = w
    previewCanvas.height = h
  }

  if (showCamera) {
    ctx.clearRect(0, 0, w, h)  // transparent: landmarks over video
  } else {
    ctx.clearRect(0, 0, w, h)
  }

  if (!result) return

  if (result.face?.faceLandmarks?.[0]) {
    ctx.fillStyle = '#ff3333'
    for (const lm of result.face.faceLandmarks[0]) {
      ctx.beginPath()
      ctx.arc((1 - lm.x) * w, lm.y * h, 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const posePoints = result.pose?.landmarks?.[0]
  if (posePoints) {
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.8)'
    ctx.lineWidth = 2
    for (const [a, b] of POSE_CONNECTIONS) {
      const la = posePoints[a]
      const lb = posePoints[b]
      if (!la || !lb) continue
      ctx.beginPath()
      ctx.moveTo((1 - la.x) * w, la.y * h)
      ctx.lineTo((1 - lb.x) * w, lb.y * h)
      ctx.stroke()
    }
    ctx.fillStyle = '#ff3333'
    for (const lm of posePoints) {
      ctx.beginPath()
      ctx.arc((1 - lm.x) * w, lm.y * h, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

const fps: FpsCounter = { value: 0, lastTime: performance.now(), frameCount: 0 }

function setStatus(text: string, type: 'ready' | 'loading' | 'error') {
  statusEl.textContent = text
  statusEl.className = type
}

const { renderer, scene, camera, controls } = createRenderer(canvas)

function tick(delta: number) {
  if (vrm) vrm.update(delta)

  controls.update()
  renderer.render(scene, camera)

  if (isTracking && tracker && video.readyState === 4) {
    try {
      const result = tracker.detect(video)
      lastTrackingResult = result
      if (vrm) applyTracking(vrm, result.face, result.pose)
    } catch (e) {
      console.warn('tracking error:', e)
    }
  }

  if (showSkeleton) {
    drawSkeleton(lastTrackingResult)
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
    showCamera = false
    lastTrackingResult = null
    updateView()
    btnCamera.textContent = 'カメラ開始'
    setStatus(vrm ? '準備完了' : 'VRM未読み込み', 'ready')
    return
  }

  try {
    setStatus('カメラ起動中...', 'loading')
    await startCamera(video)
    await initTracker()
    isTracking = true
    showCamera = true
    updateView()
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

btnViewCamera.addEventListener('click', () => { showCamera = !showCamera; updateView() })
btnViewSkeleton.addEventListener('click', () => { showSkeleton = !showSkeleton; updateView() })

btnResetView.addEventListener('click', () => {
  camera.position.set(0, 1.3, 3)
  controls.target.set(0, 1.3, 0)
  controls.update()
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
