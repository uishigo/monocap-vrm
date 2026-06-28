# 技術詳細：VRM 読み込みからモデルを動かすまで

各ライブラリがどう連携して「カメラ映像 → 3D モデルが動く」を実現しているかを、
コードレベルで追いながら解説します。

---

## 全体フロー

```
① ユーザーが .vrm ファイルを選択
         ↓
② GLTFLoader + VRMLoaderPlugin でモデルを解析し Three.js シーンへ追加
         ↓
③ requestAnimationFrame によるレンダリングループ開始（毎フレーム以下を繰り返す）
         ↓
④ MediaPipe がカメラ映像から顔・姿勢のランドマークを検出
         ↓
⑤ KalidoKit がランドマーク座標群を骨の回転角度（オイラー角）に変換
         ↓
⑥ VRM の HumanoidBone・ExpressionManager に回転値を書き込む
         ↓
⑦ vrm.update(delta) で物理・視線を更新 → Three.js がレンダリング
```

---

## ① VRM ファイル選択 — [src/main.ts:100-123](../src/main.ts#L100-L123)

```typescript
vrmFileInput.addEventListener('change', async () => {
  const file = vrmFileInput.files?.[0]
  if (!file) return

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
  } finally {
    URL.revokeObjectURL(url)   // 一時 URL を破棄してメモリを解放
  }
})
```

`URL.createObjectURL()` はファイルをメモリ上の Blob URL (`blob://...`) として扱うための変換です。
`loadAsync()` が終わるまで URL を保持し、完了後に `revokeObjectURL()` で解放します。

---

## ② GLTFLoader + VRMLoaderPlugin — [src/renderer.ts:38-52](../src/renderer.ts#L38-L52)

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
**VRMLoaderPlugin** を `loader.register()` することで VRM 固有のデータを解析できるようになります。

| 解析されるデータ | 格納先 |
|----------------|--------|
| ヒューマノイドボーン定義 | `vrm.humanoid` |
| 表情（BlendShape）定義 | `vrm.expressionManager` |
| LookAt（視線）設定 | `vrm.lookAt` |
| VRM メタ情報 | `vrm.meta` |

### `rotation.y = Math.PI` の理由

VRM の座標系ではモデルが Z+ 方向（カメラから見て奥）を向いています。
Three.js のカメラは Z- 方向に向けて配置されているため、180° 回転しないとモデルの背中が映ります。

---

## ③ レンダリングループ — [src/main.ts:57-62](../src/main.ts#L57-L62)

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

---

## ④ MediaPipe ランドマーク検出 — [src/tracker.ts](../src/tracker.ts)

`tick()` 内で毎フレーム呼ばれます（[src/main.ts:39](../src/main.ts#L39)）：

```typescript
const { face, pose } = tracker.detect(video)
```

### createTracker — モデルの初期化

```typescript
const vision = await FilesetResolver.forVisionTasks(
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
)

const [faceLandmarker, poseLandmarker] = await Promise.all([
  FaceLandmarker.createFromOptions(vision, {
    runningMode: 'VIDEO',          // 動画モード（静止画モードより最適化される）
    numFaces: 1,
    outputFacialTransformationMatrixes: true,  // 3D 頭部姿勢行列を出力
  }),
  PoseLandmarker.createFromOptions(vision, {
    runningMode: 'VIDEO',
    numPoses: 1,
  }),
])
```

`FilesetResolver` は MediaPipe の WebAssembly ランタイムをロードするユーティリティです。
初回は CDN から数十 MB のモデルファイルをダウンロードします。

### detect — 毎フレームの推定

```typescript
detect(video: HTMLVideoElement): TrackingResult {
  const now = performance.now()

  // タイムスタンプが同じなら同一フレームへの重複検出を防ぐ
  if (now !== lastFaceTimestamp) {
    face = faceLandmarker.detectForVideo(video, now)
    lastFaceTimestamp = now
  }
  // ...
}
```

| 推定器 | 出力 |
|--------|------|
| FaceLandmarker | `faceLandmarks[0]` — 顔の 478 点 (x, y, z) |
| | `facialTransformationMatrixes[0]` — 4×4 変換行列（3D 頭部姿勢） |
| PoseLandmarker | `worldLandmarks[0]` — 体の 33 点 (x, y, z, visibility) |

---

## ⑤ KalidoKit — ランドマーク → ボーン角度変換 — [src/rigger.ts:18-51](../src/rigger.ts#L18-L51)

MediaPipe が返すのはただの座標点群です。これを「骨をどのくらい回転させるか」に変換するのが KalidoKit です。

### 顔の変換

```typescript
function mediapipeFaceToKalido(result: FaceLandmarkerResult): TFace | null {
  const landmarks = result.faceLandmarks[0].map(lm => ({ x: lm.x, y: lm.y, z: lm.z ?? 0 }))
  const matrix = result.facialTransformationMatrixes[0]

  return Face.solve(landmarks, {
    runtime: 'mediapipe',
    smoothBlink: true,
    blinkSettings: [0.25, 0.75],  // まばたきの閾値（開始・完全閉じ）
    matrix: { data: Array.from(matrix.data) } as any,
  })
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
  const landmarks = result.worldLandmarks[0].map(lm => ({
    x: lm.x, y: lm.y, z: lm.z ?? 0, visibility: lm.visibility ?? 0,
  }))

  return Pose.solve(landmarks, landmarks, {
    runtime: 'mediapipe',
    video: { width: 640, height: 480 },
  })
}
```

`Pose.solve()` の戻り値 `TPose` は各ボーン名をキーとするオイラー角 `{x, y, z}` のオブジェクトです。

---

## ⑥ VRM ボーン・表情への適用 — [src/rigger.ts:53-116](../src/rigger.ts#L53-L116)

### 頭・首ボーンの回転

```typescript
const head = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)

if (head) {
  lerpEuler(head, {
    x:  faceRig.head.degrees.x * (Math.PI / 180) * 0.7,   // 度数法 → ラジアン変換 + 抑制係数
    y:  faceRig.head.degrees.y * (Math.PI / 180) * -0.7,  // Y 軸は左右反転（カメラが鏡像のため）
    z:  faceRig.head.degrees.z * (Math.PI / 180) * 0.7,
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

**Y 軸を -1 倍する理由：** カメラ映像は左右が鏡反転しているため、
検出された「右向き」はモデルの座標系では「左向き」になります。符号を反転することで補正します。

### 線形補間（lerp）による滑らか化

```typescript
const LERP = 0.3   // 毎フレーム「目標値との差の 30% だけ近づく」

function lerpEuler(bone: THREE.Object3D, target: { x: number; y: number; z: number }) {
  if (!isFinite(target.x) || !isFinite(target.y) || !isFinite(target.z)) return
  bone.rotation.x = lerp(bone.rotation.x, target.x, LERP)
  bone.rotation.y = lerp(bone.rotation.y, target.y, LERP)
  bone.rotation.z = lerp(bone.rotation.z, target.z, LERP)
}
```

検出結果をそのまま骨に適用するとフレーム間のノイズでモデルがカクカク震えます。
lerp（線形補間）で「現在値から目標値に向かって少しずつ近づける」ことで滑らかな動きになります。

**NaN ガードについて：** KalidoKit は visibility（信頼度）の低いランドマーク（腕が画面外など）に対して `NaN` を返すことがあります。`isFinite` チェックで NaN・Infinity を遮断しないと、ボーンの回転値が NaN に汚染され、Three.js の world matrix 全体が壊れます。その結果、ワールド座標から計算するひじ角度なども連鎖的に NaN になります。

```
LERP = 0.1 → 滑らか（遅延が増える）
LERP = 0.3 → デフォルト（バランス重視）
LERP = 0.7 → 素早い追従（ノイズが出やすい）
```

### 表情の適用

```typescript
if (expressionManager) {
  // eye.l は「目の開き度（0〜1）」、blink は「閉じ度（0〜1）」なので反転
  expressionManager.setValue(
    'blinkLeft',
    lerp(expressionManager.getValue('blinkLeft') ?? 0, 1 - (faceRig.eye?.l ?? 1), LERP)
  )

  // 口の形は A/I/U/E/O の各母音ブレンドシェイプに直接マッピング
  expressionManager.setValue('aa', lerp(/* ... */, faceRig.mouth?.shape?.A ?? 0, LERP))
}
```

VRM の表情システム（ExpressionManager）は各表情を `0.0`（なし）〜 `1.0`（最大）の float 値で管理します。
`setValue()` で値を書き込むと次の `vrm.update()` 時にモーフターゲット（頂点変形）に反映されます。

### 体ボーンの適用

```typescript
const boneMap: [VRMHumanBoneName, keyof TPose, number][] = [
  [VRMHumanBoneName.LeftUpperArm,  'LeftUpperArm',  1],
  [VRMHumanBoneName.LeftLowerArm,  'LeftLowerArm',  1],
  [VRMHumanBoneName.RightUpperArm, 'RightUpperArm', 1],
  [VRMHumanBoneName.RightLowerArm, 'RightLowerArm', 1],
  [VRMHumanBoneName.Hips,          'Hips',          1],
  [VRMHumanBoneName.Spine,         'Spine',         0.5],
]

for (const [boneName, rigKey, scale] of boneMap) {
  const bone = humanoid.getNormalizedBoneNode(boneName)
  const rig = poseRig[rigKey]
  if (bone && rig) lerpEuler(bone, { x: rig.x * scale, y: rig.y * scale, z: rig.z * scale })
}
```

テーブル形式にすることで「どの VRM ボーン名」「どの KalidoKit キー」「どの抑制係数」を対応させるかが
一目でわかり、ボーンの追加・変更も 1 行で済みます。

---

## ⑦ vrm.update(delta) — [src/main.ts:33](../src/main.ts#L33)

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
| ExpressionManager | `setValue()` で書き込まれた値をモーフターゲットに反映 |

**`vrm.update()` を呼ぶ前に `expressionManager.setValue()` を完了させる必要があります。**
呼び忘れると表情変化や揺れ物が機能しません。

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
@pixiv/three-vrm
  役割: VRM 仕様の正規化ボーン・表情システムを提供する
  出力: Three.js の Object3D ツリーとして Scene に追加される
        │
        ▼
Three.js (WebGL)
  役割: 3D シーンを WebGL でレンダリングする
  出力: HTMLCanvasElement への描画
```
