export async function startCamera(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  })
  video.srcObject = stream
  await new Promise<void>((resolve) => {
    video.onloadeddata = () => resolve()
  })
}

export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null
  stream?.getTracks().forEach((t) => t.stop())
  video.srcObject = null
}
