import '@fortawesome/fontawesome-free/css/all.min.css'
import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'
import { createRenderer, loadVRM } from './renderer'
import { createTracker } from './tracker'
import type { Tracker, TrackingResult } from './tracker'
import { applyTracking } from './rigger'
import { startCamera, stopCamera } from './camera'
import { drawSkeleton } from './skeleton'
import { initBackground } from './background'

interface FpsCounter {
  value: number
  lastTime: number
  frameCount: number
}

const video           = document.getElementById('camera-video')    as HTMLVideoElement
const canvas          = document.getElementById('vrm-canvas')      as HTMLCanvasElement
const previewCanvas   = document.getElementById('preview-canvas')  as HTMLCanvasElement
const statusEl        = document.getElementById('status')          as HTMLSpanElement
const fpsEl           = document.getElementById('fps')             as HTMLSpanElement
const btnCamera       = document.getElementById('btn-camera')      as HTMLButtonElement
const btnLoadVrm      = document.getElementById('btn-load-vrm')    as HTMLButtonElement
const btnCapture      = document.getElementById('btn-capture')     as HTMLButtonElement
const btnResetView    = document.getElementById('btn-reset-view')  as HTMLButtonElement
const btnMirror       = document.getElementById('btn-mirror')      as HTMLButtonElement
const btnFullscreen   = document.getElementById('btn-fullscreen')  as HTMLButtonElement
const btnBgImage      = document.getElementById('btn-bg-image')    as HTMLButtonElement
const btnViewCamera   = document.getElementById('btn-view-camera') as HTMLButtonElement
const btnViewSkeleton = document.getElementById('btn-view-skeleton') as HTMLButtonElement
const vrmFileInput    = document.getElementById('vrm-file-input')  as HTMLInputElement
const bgImageInput    = document.getElementById('bg-image-input')  as HTMLInputElement
const bgPopup         = document.getElementById('bg-popup')        as HTMLDivElement
const bpNone          = document.getElementById('bp-none')         as HTMLButtonElement
const bpColor         = document.getElementById('bp-color')        as HTMLButtonElement
const bpColorSwatch   = document.getElementById('bp-color-swatch') as HTMLButtonElement
const bpColorInput    = document.getElementById('bp-color-input')  as HTMLInputElement
const bpImage         = document.getElementById('bp-image')        as HTMLButtonElement

let vrm: VRM | null = null
let tracker: Tracker | null = null
let isTracking = false
let showCamera = false
let showSkeleton = true
let mirrorMode = true
let lastTrackingResult: TrackingResult | null = null

const fps: FpsCounter = { value: 0, lastTime: performance.now(), frameCount: 0 }

function setStatus(text: string, type: 'ready' | 'loading' | 'error') {
  statusEl.textContent = text
  statusEl.className = type
}

function updateView() {
  video.style.visibility = showCamera ? 'visible' : 'hidden'
  previewCanvas.style.display = showSkeleton ? 'block' : 'none'
  btnViewCamera.classList.toggle('active', showCamera)
  btnViewSkeleton.classList.toggle('active', showSkeleton)
}

const { renderer, scene, camera, controls } = createRenderer(canvas)

const bg = initBackground(canvas.closest('.panel') as HTMLElement, {
  btnBgImage, bgPopup, bpNone, bpColor, bpColorSwatch, bpColorInput, bpImage, bgImageInput,
})

function tick(delta: number) {
  if (vrm) vrm.update(delta)

  controls.update()
  renderer.render(scene, camera)

  if (isTracking && tracker && video.readyState === 4) {
    try {
      const result = tracker.detect(video)
      lastTrackingResult = result
      if (vrm) applyTracking(vrm, result.face, result.pose, mirrorMode)
    } catch (e) {
      console.warn('tracking error:', e)
    }
  }

  if (showSkeleton) drawSkeleton(previewCanvas, lastTrackingResult)

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
    showSkeleton = false
    lastTrackingResult = null
    updateView()
    btnCamera.innerHTML = '<i class="fa-solid fa-video-slash"></i>'
    btnCamera.title = 'カメラ: OFF'
    setStatus(vrm ? '準備完了' : 'VRM未読み込み', 'ready')
    return
  }

  try {
    setStatus('カメラ起動中...', 'loading')
    await startCamera(video)
    updateView()
    await initTracker()
    isTracking = true
    showCamera = false
    showSkeleton = true
    updateView()
    btnCamera.innerHTML = '<i class="fa-solid fa-video"></i>'
    btnCamera.title = 'カメラ: ON'
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

btnMirror.addEventListener('click', () => {
  mirrorMode = !mirrorMode
  btnMirror.title = mirrorMode ? 'ミラーリング: ON' : 'ミラーリング: OFF'
  btnMirror.classList.toggle('active', mirrorMode)
})

btnFullscreen.addEventListener('click', () => {
  const vrmPanel = canvas.closest('.panel') as HTMLElement
  if (!document.fullscreenElement) {
    vrmPanel.requestFullscreen()
  } else {
    document.exitFullscreen()
  }
})

document.addEventListener('fullscreenchange', () => {
  const isFs = !!document.fullscreenElement
  btnFullscreen.innerHTML = isFs
    ? '<i class="fa-solid fa-compress"></i>'
    : '<i class="fa-solid fa-expand"></i>'
  btnFullscreen.title = isFs ? '全画面解除' : '全画面表示'
})

btnResetView.addEventListener('click', () => {
  camera.position.set(0, 1.3, 3)
  controls.target.set(0, 1.3, 0)
  controls.update()
})

btnCapture.addEventListener('click', () => {
  renderer.render(scene, camera)

  if (bg.getMode() === 'none') {
    const link = document.createElement('a')
    link.download = `monocap-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    return
  }

  const off = document.createElement('canvas')
  off.width = canvas.width
  off.height = canvas.height
  const ctx = off.getContext('2d')!

  if (bg.getMode() === 'color') {
    ctx.fillStyle = bg.getColor()
    ctx.fillRect(0, 0, off.width, off.height)
  } else if (bg.getMode() === 'image') {
    const img = bg.getImage()
    if (img) ctx.drawImage(img, 0, 0, off.width, off.height)
  }

  ctx.drawImage(canvas, 0, 0)

  const link = document.createElement('a')
  link.download = `monocap-${Date.now()}.png`
  link.href = off.toDataURL('image/png')
  link.click()
})

setStatus('VRM を読み込んでください', 'loading')
updateView()
loop()
