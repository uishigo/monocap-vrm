# 技術詳細：VRM 読み込みからモデルを動かすまで

各ライブラリがどう連携して「カメラ映像 → 3D モデルが動く」を実現しているかを、
コードレベルで追いながら解説します。

---

## 全体フロー

```
① ユーザーが .vrm ファイルを選択
         ↓
② createRenderer で Three.js のシーン・カメラ・ライトを初期化
         ↓
③ GLTFLoader + VRMLoaderPlugin でモデルを解析し Three.js シーンへ追加
         ↓
④ requestAnimationFrame によるレンダリングループ開始（毎フレーム以下を繰り返す）
         ↓
⑤ MediaPipe がカメラ映像から顔・姿勢のランドマークを検出
         ↓
⑥ KalidoKit がランドマーク座標群を骨の回転角度（オイラー角）に変換
         ↓
⑦ applyTracking が VRM の HumanoidBone・ExpressionManager に回転値を書き込む
         ↓
⑧ vrm.update(delta) で物理・視線を更新 → Three.js がレンダリング
         ↓
⑨ previewCanvas にスケルトンを描画してユーザーに検出状態を可視化
```

---

## モジュール構成

| ファイル | 役割 |
|----------|------|
| [src/main.ts](../src/main.ts) | エントリポイント。UI イベント・ループ管理 |
| [src/renderer.ts](../src/renderer.ts) | Three.js シーン初期化・VRM 読み込み |
| [src/tracker.ts](../src/tracker.ts) | MediaPipe ランドマーク検出 |
| [src/rigger.ts](../src/rigger.ts) | KalidoKit → VRM ボーン・表情への適用 |
| [src/skeleton.ts](../src/skeleton.ts) | キャンバスへのスケルトン描画 |
| [src/background.ts](../src/background.ts) | 背景（なし・カラー・画像）管理 |
| [src/camera.ts](../src/camera.ts) | カメラストリーム起動・停止 |

---

## ① VRM ファイル選択 — [src/main.ts:151-174](../src/main.ts#L151-L174)

```typescript
vrmFileInput.addEventListener('change', async () => {
  const file = vrmFileInput.files?.[0]
  if (!file) return

  setStatus('VRM 読み込み中...', 'loading')
  const url = URL.createObjectURL(file)   // ローカルファイルを一時 URL に変換
  try {
    // 古いモデルが存在する場合はメモリを解放してから差し替え
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
  } finally {
    URL.revokeObjectURL(url)   // 一時 URL を破棄してメモリを解放
    vrmFileInput.value = ''    // 同じファイルを再選択できるようにリセット
  }
})
```

### なぜ `URL.createObjectURL()` が必要なのか

ブラウザのセキュリティ制限により、JavaScript はローカルのファイルパス（`C:\Users\...`）を直接 fetch/load できません。
`URL.createObjectURL()` はファイルの内容をメモリ上に保持し、`blob://...` という一時的な URL を発行します。
この URL は同一タブ内でのみ有効で、`revokeObjectURL()` を呼ぶか、タブを閉じると無効になります。

### `vrm.scene.traverse()` でメモリを解放する理由

Three.js のジオメトリ（頂点データ）は GPU メモリに転送されています。
`scene.remove()` だけでは JavaScript 側の参照が切れるだけで GPU のメモリは残ります。
`geometry.dispose()` を呼ぶことで GPU 側も解放されます。新しいモデルを何度も読み込む際の
メモリリーク防止に必要な処理です。

---

## ② Three.js シーンの初期化 — [src/renderer.ts:7-52](../src/renderer.ts#L7-L52)

VRM を表示するための「舞台」を用意するのが `createRenderer()` です。

```typescript
export function createRenderer(canvas: HTMLCanvasElement) {
  // WebGL レンダラー（alpha: true で背景を透明に）
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio)  // 高解像度ディスプレイ対応
  renderer.setSize(canvas.clientWidth, canvas.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace  // 色空間を sRGB に設定

  const scene = new THREE.Scene()

  // 視野角 30°・アスペクト比はキャンバスに合わせる
  const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20)
  camera.position.set(0, 1.3, 3)  // 腰あたりの高さから 3m 離れた位置

  // 環境光（全方向から均一に照らす）
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  // 指向性ライト（太陽光のように一方向から）
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
  dirLight.position.set(1, 2, 3)
  scene.add(dirLight)

  // OrbitControls — マウスドラッグでカメラを自由に動かせる
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 1.3, 0)   // 注視点もカメラと同じ高さ
  controls.enableDamping = true     // 慣性でゆっくり止まる
  controls.dampingFactor = 0.1
  controls.minDistance = 0.5        // モデルに近づきすぎを防ぐ
  controls.maxDistance = 10

  // キャンバスサイズ変更（ウィンドウリサイズ・全画面）に追従
  const applySize = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()  // アスペクト比の変更を投影行列に反映
  }
  new ResizeObserver(applySize).observe(canvas)
  document.addEventListener('fullscreenchange', () => requestAnimationFrame(applySize))

  return { renderer, scene, camera, controls }
}
```

### 各コンポーネントの役割

| コンポーネント | 役割 |
|----------------|------|
| `WebGLRenderer` | JavaScript の命令を WebGL API に翻訳して GPU に送る |
| `Scene` | 「シーン」。ライト・モデル・カメラが配置される 3D 空間 |
| `PerspectiveCamera` | 透視投影カメラ。遠いものが小さく見える自然な視点 |
| `AmbientLight` | 環境光。影が真っ黒にならないよう全体を薄く照らす |
| `DirectionalLight` | 指向性ライト。影を作り立体感を出す |
| `OrbitControls` | マウス操作でカメラを動かす。Three.js 本体には含まれない addon |

### `updateProjectionMatrix()` を忘れると何が起きるか

カメラのパラメータ（アスペクト比・視野角）を変えた後に呼ばないと、内部の行列が古いまま残ります。
リサイズ後に画像が引き伸びたり、オブジェクトが正しい位置に表示されなくなります。

---

## ③ GLTFLoader + VRMLoaderPlugin — [src/renderer.ts:54-68](../src/renderer.ts#L54-L68)

```typescript
export async function loadVRM(scene: THREE.Scene, url: string): Promise<VRM> {
  const loader = new GLTFLoader()
  loader.register((parser) => new VRMLoaderPlugin(parser))  // VRM 拡張を登録

  const gltf = await loader.loadAsync(url)
  const vrm: VRM = gltf.userData.vrm   // プラグインが解析済み VRM オブジェクトをここに格納

  VRMUtils.removeUnnecessaryVertices(gltf.scene)  // 不要頂点の削除
  VRMUtils.combineSkeletons(gltf.scene)           // スケルトン統合（描画コール削減）

  vrm.scene.rotation.y = Math.PI   // モデルを 180° 回転してカメラに向ける
  scene.add(vrm.scene)

  return vrm
}
```

### GLTFLoader とは

`.glb` / `.gltf` 形式を読み込む Three.js の標準ローダーです。VRM は glTF 2.0 の拡張仕様で、
**VRMLoaderPlugin** を `loader.register()` することで VRM 固有のデータを解析できます。

| 解析されるデータ | 格納先 |
|----------------|--------|
| ヒューマノイドボーン定義 | `vrm.humanoid` |
| 表情（BlendShape）定義 | `vrm.expressionManager` |
| LookAt（視線）設定 | `vrm.lookAt` |
| VRM メタ情報 | `vrm.meta` |

### `rotation.y = Math.PI` の理由

VRM の座標系ではモデルが Z+ 方向（カメラから見て奥）を向いています。
Three.js のカメラは Z- 方向に向けて配置されているため、180° 回転しないとモデルの背中が映ります。

### `VRMUtils` の最適化処理

| メソッド | 効果 |
|----------|------|
| `removeUnnecessaryVertices` | 非表示部分の頂点を削除。GPU 転送量を減らす |
| `combineSkeletons` | 複数のスケルトンを統合。ドローコール（描画命令回数）を削減してフレームレート向上 |

---

## ④ レンダリングループ — [src/main.ts:97-103](../src/main.ts#L97-L103)

```typescript
let prevTime = performance.now()

function loop() {
  requestAnimationFrame(loop)           // 次フレームに自分を再登録（再帰ではなくコールバック登録）
  const now = performance.now()
  tick((now - prevTime) / 1000)         // 経過時間を秒単位で渡す
  prevTime = now
}

loop()  // 初回呼び出しでループ開始
```

`requestAnimationFrame` はブラウザの描画タイミング（通常 60fps、高リフレッシュレート環境では 120fps）に
合わせてコールバックを呼び出します。`delta`（前フレームからの経過秒）を渡すことで、フレームレートに依存しない
動きの速度計算が可能になります。

### tick() の内部処理 — [src/main.ts:69-95](../src/main.ts#L69-L95)

`tick()` は 1 フレームの全処理をまとめた関数です：

```typescript
function tick(delta: number) {
  // ① VRM の物理・表情を更新（ボーン操作後に必ず呼ぶ）
  if (vrm) vrm.update(delta)

  // ② カメラの慣性動作を更新（enableDamping が有効なため必要）
  controls.update()

  // ③ 3D シーンを描画
  renderer.render(scene, camera)

  // ④ カメラが有効 かつ 映像が再生可能な状態なら姿勢推定を実行
  if (isTracking && tracker && video.readyState === 4) {
    try {
      const result = tracker.detect(video)
      lastTrackingResult = result
      if (vrm) applyTracking(vrm, result.face, result.pose, mirrorMode)
    } catch (e) {
      console.warn('tracking error:', e)
    }
  }

  // ⑤ スケルトンをオーバーレイ描画
  if (showSkeleton) drawSkeleton(previewCanvas, lastTrackingResult)

  // ⑥ FPS カウント（1 秒ごとに表示を更新）
  fps.frameCount++
  const now = performance.now()
  if (now - fps.lastTime >= 1000) {
    fps.value = fps.frameCount
    fps.frameCount = 0
    fps.lastTime = now
    fpsEl.textContent = `${fps.value} fps`
  }
}
```

`video.readyState === 4` は HTML の `HAVE_ENOUGH_DATA` 定数で、映像が再生できる状態になったことを確認しています。
カメラが起動直後でバッファリング中は `readyState` が低い値になるため、このチェックで早すぎる推定を防いでいます。

---

## ⑤ MediaPipe ランドマーク検出 — [src/tracker.ts](../src/tracker.ts)

### createTracker — AI モデルの初期化

```typescript
export async function createTracker(): Promise<Tracker> {
  // MediaPipe の WebAssembly ランタイムをロード
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  // 顔検出モデルと姿勢検出モデルを並列でダウンロード・初期化
  const [faceLandmarker, poseLandmarker] = await Promise.all([
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/.../face_landmarker.task',
        delegate: 'CPU',  // GPU より CPU の方が安定するため
      },
      runningMode: 'VIDEO',                        // 動画モード（静止画モードより最適化される）
      numFaces: 1,
      outputFaceBlendshapes: true,                 // 表情ブレンドシェイプを出力
      outputFacialTransformationMatrixes: true,    // 3D 頭部姿勢行列を出力
    }),
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/.../pose_landmarker_lite.task',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    }),
  ])
  // ...
}
```

`FilesetResolver` は MediaPipe の WebAssembly ランタイムをロードするユーティリティです。
初回は CDN から AI モデルファイル（数十 MB）をダウンロードするため、`createTracker()` の完了まで数秒かかります。

`Promise.all()` で 2 つのモデルを並列ダウンロードすることで、直列の場合と比べて初期化時間を約半分に短縮しています。

### detect — 毎フレームの推定

```typescript
detect(video: HTMLVideoElement): TrackingResult {
  const now = performance.now()

  let face: FaceLandmarkerResult | null = null
  let pose: PoseLandmarkerResult | null = null

  // タイムスタンプが前回と異なるときだけ推定（同一フレームへの重複検出を防ぐ）
  if (now !== lastFaceTimestamp) {
    face = faceLandmarker.detectForVideo(video, now)
    lastFaceTimestamp = now
  }
  if (now !== lastPoseTimestamp) {
    pose = poseLandmarker.detectForVideo(video, now)
    lastPoseTimestamp = now
  }

  return { face, pose }
}
```

| 推定器 | 出力 |
|--------|------|
| FaceLandmarker | `faceLandmarks[0]` — 顔の 478 点 (x, y, z) |
| | `facialTransformationMatrixes[0]` — 4×4 変換行列（3D 頭部姿勢） |
| PoseLandmarker | `worldLandmarks[0]` — 体の 33 点 (x, y, z, visibility) |
| | `landmarks[0]` — 画面座標系の 33 点（スケルトン描画に使用） |

ランドマークの座標は 0.0〜1.0 に正規化されています（x: 画面左端=0, 右端=1 / y: 上端=0, 下端=1）。
実際の画面座標に変換するにはキャンバスの幅・高さを乗算します。

---

## ⑥ KalidoKit — ランドマーク → ボーン角度変換 — [src/rigger.ts:20-47](../src/rigger.ts#L20-L47)

MediaPipe が返すのはただの座標点群です。これを「骨をどのくらい回転させるか」に変換するのが KalidoKit です。

### 顔の変換

```typescript
function mediapipeFaceToKalido(result: FaceLandmarkerResult): TFace | null {
  // ランドマークが取得できていない場合は null を返す（カメラ外など）
  if (!result.faceLandmarks?.length || !result.facialTransformationMatrixes?.length) return null

  const landmarks = result.faceLandmarks[0].map((lm) => ({ x: lm.x, y: lm.y, z: lm.z ?? 0 }))

  return Face.solve(landmarks, {
    runtime: 'mediapipe',
    imageSize: { width: 640, height: 480 },
    smoothBlink: true,          // まばたきを滑らかにする
    blinkSettings: [0.25, 0.75], // まばたきの閾値（開始・完全閉じ）
  } as any) ?? null
}
```

`Face.solve()` の戻り値 `TFace` の主なフィールド：

| フィールド | 内容 |
|-----------|------|
| `head.degrees.x/y/z` | 頭の傾き・振り向き・回転（度数法） |
| `eye.l / eye.r` | 目の開き具合（0 = 閉じ / 1 = 開き） |
| `mouth.shape.A/I/U/E/O` | 母音ごとの口の形（0〜1） |

### 体の変換

```typescript
function mediapipePoseToKalido(result: PoseLandmarkerResult): TPose | null {
  if (!result.worldLandmarks?.length) return null

  const landmarks = result.worldLandmarks[0].map((lm) => ({
    x: lm.x, y: lm.y, z: lm.z ?? 0,
    visibility: lm.visibility ?? 0,  // 信頼度（0〜1）。画面外や隠れた部位は低くなる
  }))

  // 第 1・第 2 引数ともに worldLandmarks を渡す（KalidoKit の API 仕様）
  return Pose.solve(landmarks, landmarks, {
    runtime: 'mediapipe',
    imageSize: { width: 640, height: 480 },
  } as any) ?? null
}
```

`Pose.solve()` の戻り値 `TPose` は各ボーン名をキーとするオイラー角 `{x, y, z}` のオブジェクトです。

---

## ⑦ VRM ボーン・表情への適用 — [src/rigger.ts:68-124](../src/rigger.ts#L68-L124)

### ミラーリングモードの軸補正

```typescript
export function applyTracking(vrm, face, pose, mirror = true) {
  const s = mirror ? 1 : -1  // ミラーON: +1、ミラーOFF: -1
```

カメラ映像はデフォルトで**左右が鏡反転**しています。
`mirror = true`（デフォルト）のときは映像もモデルも同じ方向に動くため、ユーザーは鏡を見るような操作感になります。
`mirror = false` のときは `s = -1` として Y・Z 軸を反転し、体の左右をモデルの座標系に合わせます。

### 頭・首ボーンの回転

```typescript
const DEG = Math.PI / 180  // 度数法 → ラジアン変換係数（モジュールレベル定数）

if (head) {
  lerpEuler(head, {
    x:  faceRig.head.degrees.x * DEG * 0.7,
    y:  faceRig.head.degrees.y * DEG * 0.7 * s,  // ミラー補正
    z:  faceRig.head.degrees.z * DEG * 0.7 * s,  // ミラー補正
  })
}
if (neck) {
  lerpEuler(neck, {
    x:  faceRig.head.degrees.x * DEG * 0.3,
    y:  faceRig.head.degrees.y * DEG * 0.3 * s,
    z:  faceRig.head.degrees.z * DEG * 0.3 * s,
  })
}
```

**`getNormalizedBoneNode()`** は VRM 標準ボーン名でノードを取得します。
モデルによってボーン名や構造が異なっても、VRM の正規化レイヤーが吸収するため
コード側は常に `VRMHumanBoneName.Head` のような定数で指定できます。

**スケール係数の意図：**

| ボーン | 係数 | 理由 |
|--------|------|------|
| Head | 0.7 | 実際の動きより少し抑えてナチュラルに |
| Neck | 0.3 | 首は頭の補助的な動きなので控えめに |
| Spine | 0.5 | 上半身のゆらぎを半分に抑制 |

**`DEG` 定数について：** KalidoKit は頭部角度を度数法（°）で返しますが、
Three.js はラジアン（rad）で扱います。180° = π rad の関係から `× (Math.PI / 180)` で変換しています。
繰り返し計算されるためモジュールレベルの定数 `DEG` として抽出しています。

### 線形補間（lerp）による滑らか化

```typescript
const LERP = 0.3   // 毎フレーム「目標値との差の 30% だけ近づく」

function lerpEuler(bone: THREE.Object3D, target: { x: number; y: number; z: number }) {
  // NaN や Infinity が来た場合は更新しない（ガード）
  if (!isFinite(target.x) || !isFinite(target.y) || !isFinite(target.z)) return
  bone.rotation.x = lerp(bone.rotation.x, target.x, LERP)
  bone.rotation.y = lerp(bone.rotation.y, target.y, LERP)
  bone.rotation.z = lerp(bone.rotation.z, target.z, LERP)
}
```

検出結果をそのまま骨に適用するとフレーム間のノイズでモデルがカクカク震えます。
lerp（線形補間）で「現在値から目標値に向かって少しずつ近づける」ことで滑らかな動きになります。

```
LERP = 0.1 → 滑らか（遅延が増える）
LERP = 0.3 → デフォルト（バランス重視）
LERP = 0.7 → 素早い追従（ノイズが出やすい）
```

**NaN ガードについて：** KalidoKit は visibility（信頼度）の低いランドマーク（腕が画面外など）に対して
`NaN` を返すことがあります。`isFinite` チェックで NaN・Infinity を遮断しないと、ボーンの回転値が NaN に汚染され、
Three.js の world matrix 全体が壊れます。その結果、ワールド座標から計算するひじ角度なども連鎖的に NaN になります。

### 表情の適用

```typescript
if (expressionManager) {
  // eye.l / eye.r は「目の開き度（0〜1）」。blink は「閉じ度」なので 1 から引いて反転
  // expressionManager.getValue() で現在値を取得し lerp の起点にする
  expressionManager.setValue('blinkLeft',  lerp(expressionManager.getValue('blinkLeft')  ?? 0, 1 - (faceRig.eye?.l ?? 1), LERP))
  expressionManager.setValue('blinkRight', lerp(expressionManager.getValue('blinkRight') ?? 0, 1 - (faceRig.eye?.r ?? 1), LERP))

  // 口の形は 5 母音ブレンドシェイプに直接マッピング
  expressionManager.setValue('aa', lerp(expressionManager.getValue('aa') ?? 0, faceRig.mouth?.shape?.A ?? 0, LERP))
  expressionManager.setValue('ih', lerp(expressionManager.getValue('ih') ?? 0, faceRig.mouth?.shape?.I ?? 0, LERP))
  expressionManager.setValue('ou', lerp(expressionManager.getValue('ou') ?? 0, faceRig.mouth?.shape?.U ?? 0, LERP))
  expressionManager.setValue('ee', lerp(expressionManager.getValue('ee') ?? 0, faceRig.mouth?.shape?.E ?? 0, LERP))
  expressionManager.setValue('oh', lerp(expressionManager.getValue('oh') ?? 0, faceRig.mouth?.shape?.O ?? 0, LERP))
}
```

VRM の表情システム（ExpressionManager）は各表情を `0.0`（なし）〜 `1.0`（最大）の float 値で管理します。
`setValue()` で値を書き込むと次の `vrm.update()` 時にモーフターゲット（頂点変形）に反映されます。
lerp の「現在値」は `expressionManager.getValue()` で取得します。これにより bone の rotation と同じ方法で補間できます。

### 体ボーンの適用 — [src/rigger.ts:49-121](../src/rigger.ts#L49-L121)

ボーンマップはモジュールレベルの定数として分離されています。ミラーモードで共通の腰・背骨（`SHARED_BONES`）と、
ミラーモードで左右が変わる腕ボーン（`ARM_BONES_MIRROR` / `ARM_BONES_DIRECT`）に分けることで、
`applyTracking` 内部の条件分岐を最小化しています。

```typescript
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
  // ミラーOFF では KalidoKit の Left と VRM の Right を対応させる
  [VRMHumanBoneName.LeftUpperArm,  'RightUpperArm', 1],
  [VRMHumanBoneName.LeftLowerArm,  'RightLowerArm', 1],
  [VRMHumanBoneName.RightUpperArm, 'LeftUpperArm',  1],
  [VRMHumanBoneName.RightLowerArm, 'LeftLowerArm',  1],
]

// 実行時は 2 つのリストを結合するだけ
const boneMap = [...(mirror ? ARM_BONES_MIRROR : ARM_BONES_DIRECT), ...SHARED_BONES]

for (const [boneName, rigKey, scale] of boneMap) {
  const bone = humanoid.getNormalizedBoneNode(boneName)
  const rig = poseRig[rigKey]
  if (bone && rig) {
    lerpEuler(bone, {
      x: rig.x * scale,
      y: rig.y * scale * s,  // ミラー補正
      z: rig.z * scale * s,  // ミラー補正
    })
  }
}
```

ミラーOFF のとき、ボーンマップの左右を入れ替えることで「カメラ映像の右腕 → モデルの右腕」という自然な対応を実現しています。
軸補正（`* s`）だけでなく、ボーン対応表の入れ替えも必要な点がポイントです。

---

## ⑧ vrm.update(delta) — [src/main.ts:70](../src/main.ts#L70)

```typescript
function tick(delta: number) {
  if (vrm) vrm.update(delta)   // ← ボーン操作後に必ず呼ぶ

  renderer.render(scene, camera)
  // ...
}
```

`vrm.update()` は `@pixiv/three-vrm` 内部の更新処理で、以下を実行します：

| 処理 | 内容 |
|------|------|
| SpringBone | 髪・スカートなどの揺れ物物理シミュレーション |
| LookAt | `vrm.lookAt.target` を向くように目・頭を追従 |
| ExpressionManager | `setValue()` で書き込まれた値をモーフターゲット（頂点変形）に反映 |

**`vrm.update()` を呼ぶ前に `expressionManager.setValue()` を完了させる必要があります。**
呼び忘れると表情変化や揺れ物が機能しません。

---

## ⑨ スケルトンのオーバーレイ描画 — [src/skeleton.ts:10-53](../src/skeleton.ts#L10-L53)

ユーザーが自分の姿勢をリアルタイムで確認できるように、カメラ映像の上に関節点と骨格線を描画します。
`drawSkeleton` は描画先の `canvas` を引数で受け取り、main.ts への依存がない独立したモジュールです。

```typescript
export function drawSkeleton(canvas: HTMLCanvasElement, result: TrackingResult | null) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.clientWidth
  const h = canvas.clientHeight
  // CSS サイズと一致させてピクセルの歪みを防ぐ
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }

  ctx.clearRect(0, 0, w, h)
  if (!result) return

  // 顔ランドマーク（478 点）を赤い点で描画
  if (result.face?.faceLandmarks?.[0]) {
    ctx.fillStyle = '#ff3333'
    for (const lm of result.face.faceLandmarks[0]) {
      // (1 - lm.x) で X 軸を反転（ミラー表示に合わせる）
      ctx.beginPath()
      ctx.arc((1 - lm.x) * w, lm.y * h, 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 体の骨格（接続リストに従って線を引く）
  const posePoints = result.pose?.landmarks?.[0]
  if (posePoints) {
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.8)'
    ctx.lineWidth = 2
    for (const [a, b] of POSE_CONNECTIONS) {
      ctx.beginPath()
      ctx.moveTo((1 - posePoints[a].x) * w, posePoints[a].y * h)
      ctx.lineTo((1 - posePoints[b].x) * w, posePoints[b].y * h)
      ctx.stroke()
    }
    // 関節点
    ctx.fillStyle = '#ff3333'
    for (const lm of posePoints) {
      ctx.beginPath()
      ctx.arc((1 - lm.x) * w, lm.y * h, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
```

`POSE_CONNECTIONS` は MediaPipe の 33 点のうち、どの点とどの点を線で結ぶかを定義した配列です：

```typescript
const POSE_CONNECTIONS: [number, number][] = [
  [11, 12],  // 左肩 - 右肩
  [11, 13],  // 左肩 - 左ひじ
  [13, 15],  // 左ひじ - 左手首
  // ... 脚・腰のつながりも同様
]
```

X 座標を `1 - lm.x` として反転しているのは、スケルトン表示をカメラ映像（鏡）の見た目に合わせるためです。

---

## ライブラリ間の責務分担まとめ

```
MediaPipe Tasks-Vision
  役割: カメラ映像から座標点群を取り出す
  出力: ピクセル座標・ワールド座標のランドマーク配列
        │
        ▼
KalidoKit
  役割: 座標点群を「骨をどう回すか」に変換する
  出力: オイラー角 { x, y, z } と表情係数 { A, I, U, E, O, l, r }
        │
        ▼
applyTracking（src/rigger.ts）
  役割: KalidoKit の出力を VRM ボーンに書き込む
        ミラーモードに応じた軸補正とボーン左右入れ替えも担当
        │
        ▼
@pixiv/three-vrm
  役割: VRM 仕様の正規化ボーン・表情システムを提供する
  出力: Three.js の Object3D ツリーとして Scene に追加される
        │
        ▼
Three.js (WebGL)
  役割: 3D シーンを WebGL でレンダリングする
  出力: HTMLCanvasElement への描画
```
