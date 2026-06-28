# 環境構築手順

## 前提条件

| ツール | 推奨バージョン | 確認コマンド |
|--------|--------------|------------|
| Node.js | 20 LTS 以上 | `node -v` |
| npm | 10 以上 | `npm -v` |
| モダンブラウザ | Chrome 117+ / Edge 117+ | — |

> **注意**: MediaPipe Tasks-Vision は WebGPU / WebAssembly を使用するため、**HTTPS または localhost** 上でのみ動作します。

---

## インストール手順

### 1. リポジトリのクローン（またはダウンロード）

```bash
# すでにローカルにある場合はスキップ
git clone <リポジトリURL>
cd monocap-vrm
```

### 2. 依存パッケージのインストール

```bash
npm install
```

インストールされる主なパッケージ：

| パッケージ | 役割 |
|-----------|------|
| `three` | 3D レンダリングエンジン |
| `@pixiv/three-vrm` | VRM モデルのロード・制御 |
| `@mediapipe/tasks-vision` | 顔・姿勢のリアルタイム推定 |
| `kalidokit` | MediaPipe の推定結果を VRM ボーン角度に変換 |
| `vite` | 開発サーバー・バンドラー |

---

## ディレクトリ構成

```
monocap-vrm/
├── docs/                  # 本ドキュメント
│   ├── setup.md           # 環境構築手順（本ファイル）
│   └── usage.md           # 使い方・実行手順
├── src/
│   ├── main.ts            # エントリポイント・UI イベント
│   ├── renderer.ts        # Three.js シーン・VRM ローダー
│   ├── tracker.ts         # MediaPipe 顔・姿勢推定
│   ├── rigger.ts          # 推定結果 → VRM ボーン適用
│   ├── camera.ts          # カメラ起動・停止
│   └── types.ts           # 共通型定義
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts（任意）
```

---

## トラブルシューティング

### `npm install` でエラーが出る

```bash
# キャッシュをクリアして再試行
npm cache clean --force
npm install
```

### カメラが起動しない

- ブラウザのカメラ許可が「ブロック」になっていないか確認
- アドレスバーが `http://localhost:...` であることを確認（`file://` は不可）

### AI モデルの読み込みが遅い / 失敗する

- 初回起動時は MediaPipe のモデルファイル（数十 MB）をCDNからダウンロードします
- インターネット接続が必要です
- プロキシ環境では `cdn.jsdelivr.net` と `storage.googleapis.com` への通信を許可してください
