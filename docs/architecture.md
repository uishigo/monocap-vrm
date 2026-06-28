# アーキテクチャ概要

## モジュール構成

```
src/
├── main.ts       UI イベント・メインループ
├── renderer.ts   Three.js シーン管理・VRM ローダー
├── tracker.ts    MediaPipe 推定器のラッパー
├── rigger.ts     推定結果 → VRM ボーン適用ロジック
├── camera.ts     ブラウザカメラ API のラッパー
└── types.ts      共通型定義
```

## データフロー

```
[HTMLVideoElement]
       │ 毎フレーム (requestAnimationFrame)
       ▼
[tracker.ts] detectForVideo()
       │
       ├─ FaceLandmarkerResult
       │     └─ faceLandmarks[0]     468点 (x,y,z)
       │     └─ faceBlendshapes[0]   52個の表情係数
       │     └─ transformationMatrix 顔の3D姿勢行列
       │
       └─ PoseLandmarkerResult
             └─ worldLandmarks[0]   33点 (x,y,z,visibility)
       │
       ▼
[rigger.ts] applyTracking()
       │
       ├─ Face.solve() → TFace
       │     └─ head.degrees (x/y/z)
       │     └─ eye.l / eye.r (開度 0〜1)
       │     └─ mouth.shape (A/I/U/E/O 各 0〜1)
       │
       └─ Pose.solve() → TPose
             └─ LeftUpperArm / RightUpperArm 等 (x/y/z rad)
       │
       ├─ humanoid.getNormalizedBoneNode() → ボーン回転を lerp 更新
       └─ expressionManager.setValue()    → 表情値を lerp 更新
       │
       ▼
[renderer.ts] renderer.render(scene, camera)
       │
       ▼
[HTMLCanvasElement] → 画面表示
```

## パフォーマンス特性

| 処理 | コスト | 備考 |
|------|--------|------|
| FaceLandmarker | 中 | GPU デリゲート使用で ~2ms/frame |
| PoseLandmarker (lite) | 小 | lite モデル使用で ~3ms/frame |
| Three.js render | 小 | ~1ms/frame (低ポリ VRM) |
| Kalidokit solve | 小 | ~0.1ms/frame |

Chrome DevTools の Performance パネルで `requestAnimationFrame` コールバックを確認することを推奨。

## 今後の拡張ポイント

| 機能 | 実装方針 |
|------|---------|
| 手トラッキング | MediaPipe HandLandmarker を追加、指ボーンに適用 |
| 深度推定 | MediaPipe Depth Anything で奥行き情報を付加 |
| 背景除去 | MediaPipe Image Segmenter でセルフィーマスク生成 |
| 録画機能 | `MediaRecorder` + `canvas.captureStream()` |
| WebRTC 配信 | `RTCPeerConnection` で映像を送信 |
