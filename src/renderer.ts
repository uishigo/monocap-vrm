import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import type { VRM } from '@pixiv/three-vrm'

export function createRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(canvas.clientWidth, canvas.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()

  const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20)
  camera.position.set(0, 1.3, 3)

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
  dirLight.position.set(1, 2, 3)
  scene.add(dirLight)

  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 1.3, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.1
  controls.minDistance = 0.5
  controls.maxDistance = 10
  controls.update()

  const applySize = () => {
    canvas.style.width = ''
    canvas.style.height = ''
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  const resizeObserver = new ResizeObserver(applySize)
  resizeObserver.observe(canvas)

  document.addEventListener('fullscreenchange', () => {
    requestAnimationFrame(applySize)
  })

  return { renderer, scene, camera, controls }
}

export async function loadVRM(scene: THREE.Scene, url: string): Promise<VRM> {
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))

  const gltf = await loader.loadAsync(url)
  const vrm: VRM = gltf.userData.vrm

  VRMUtils.removeUnnecessaryVertices(gltf.scene)
  VRMUtils.combineSkeletons(gltf.scene)

  vrm.scene.rotation.y = Math.PI
  scene.add(vrm.scene)

  return vrm
}
