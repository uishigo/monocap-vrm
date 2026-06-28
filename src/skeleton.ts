import type { TrackingResult } from './tracker'

const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32],
]

export function drawSkeleton(canvas: HTMLCanvasElement, result: TrackingResult | null) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }

  ctx.clearRect(0, 0, w, h)
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
