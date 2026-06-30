# アーキテクチャ概要

## モジュール構成

```
src/
├── main.ts         UI イベント・メインループ・トラッカー切り替え
├── renderer.ts     Three.js シーン管理・VRM ローダー
├── tracker.ts      MediaPipe ラッパー（ローカル / リモート両対応）
├── rigger.ts       ランドマーク → VRM ボーン適用ロジック
├── camera.ts       ブラウザカメラ API のラッパー
├── skeleton.ts     骨格プレビューの Canvas 描画
└── background.ts   背景設定 UI

server/             リモートトラッキングサーバー（オプション）
└── main.py         FastAPI WebSocket サーバー（MediaPipe Python）
```

---

## データフロー

### ローカルモード（デフォルト）

```
[HTMLVideoElement]
       │ 毎フレーム（モバイル 10fps / PC 30fps）
       ▼
[tracker.ts] createTracker()
  MediaPipe WASM（ブラウザ内実行）
  ├─ FaceLandmarker  → faceLandmarks[0]  468点 (x,y,z)
  └─ PoseLandmarker  → worldLandmarks[0]  33点 (x,y,z,visibility)
                       landmarks[0]       33点 正規化座標（骨格描画用）
       │
       ▼
[rigger.ts] applyTracking()  ← kalidokit による解決
[skeleton.ts] drawSkeleton()
       │
       ▼
[renderer.ts] renderer.render()
       │
       ▼
[HTMLCanvasElement] → 画面表示
```

### リモートモード（`?server=ws://...` 指定時）

```
[HTMLVideoElement]
       │ JPEG キャプチャ（320×240, quality 0.7）
       ▼
[tracker.ts] createRemoteTracker()
  WebSocket 送信 ──────────────────────────► [server/main.py]
                                              MediaPipe Python (C++)
                                              ├─ FaceLandmarker
                                              └─ PoseLandmarker
  WebSocket 受信 ◄────────────────────────── ランドマーク JSON
       │ キャッシュ結果を即時返却（非同期）
       ▼
[rigger.ts] applyTracking()  ← kalidokit による解決（クライアント側）
[skeleton.ts] drawSkeleton()
       │
       ▼
[renderer.ts] renderer.render()
       │
       ▼
[HTMLCanvasElement] → 画面表示
```

---

## サーバーとの通信仕様

| 方向 | 形式 | 内容 |
|------|------|------|
| Client → Server | Binary (JPEG) | 320×240 カメラフレーム |
| Server → Client | JSON テキスト | face / pose ランドマーク |

サーバーが返す JSON の構造：

```json
{
  "face": {
    "faceLandmarks": [[{"x": 0.5, "y": 0.3, "z": -0.01}, ...]],
    "facialTransformationMatrixes": [{}]
  },
  "pose": {
    "worldLandmarks": [[{"x": 0.1, "y": -0.5, "z": 0.0, "visibility": 0.99}, ...]],
    "landmarks":      [[{"x": 0.5, "y": 0.3,  "z": 0.0, "visibility": 0.99}, ...]]
  }
}
```

`face` / `pose` は検出されなかった場合 `null` になります。  
構造が `FaceLandmarkerResult` / `PoseLandmarkerResult` の部分集合と一致するため、`rigger.ts` と `skeleton.ts` はそのまま再利用できます。

---

## パフォーマンス特性

### ローカルモード

| 処理 | PC（GPU） | モバイル（CPU強制） |
|------|----------|-------------------|
| FaceLandmarker | ~2ms | ~40〜80ms |
| PoseLandmarker (lite) | ~3ms | ~60〜120ms |
| Three.js render | ~1ms | ~5〜10ms |
| Kalidokit solve | ~0.1ms | ~0.5ms |

> スマホでは Three.js と MediaPipe が GPU メモリを競合するため CPU delegate に固定。  
> 顔・姿勢を交互に処理し、1フレームあたりの ML コストを半減させている。

### リモートモード

| 処理 | コスト |
|------|--------|
| JPEG エンコード（クライアント） | ~2ms |
| WebSocket 往復（LAN） | ~10〜50ms |
| MediaPipe 推論（サーバー GPU） | ~5〜10ms |
| Kalidokit solve（クライアント） | ~0.1ms |
| Three.js render（クライアント、GPU 専有可） | ~1〜5ms |

スマホ CPU はほぼ Three.js 描画のみに使えるため、描画品質と FPS が向上する。

---

## 今後の拡張ポイント

| 機能 | 実装方針 |
|------|---------|
| 手トラッキング | MediaPipe HandLandmarker を追加、指ボーンに適用 |
| 深度推定 | MediaPipe Depth Anything で奥行き情報を付加 |
| 背景除去 | MediaPipe Image Segmenter でセルフィーマスク生成 |
| 録画機能 | `MediaRecorder` + `canvas.captureStream()` |
| WebRTC 配信 | `RTCPeerConnection` で VRM 映像を送信 |
| サーバー GPU 対応 | `server/main.py` の `delegate` を `GPU` に変更（CUDA 環境） |
