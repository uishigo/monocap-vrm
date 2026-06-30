# 環境構築手順

## 前提条件

### フロントエンド（必須）

| ツール | 推奨バージョン | 確認コマンド |
|--------|--------------|------------|
| Node.js | 20 LTS 以上 | `node -v` |
| npm | 10 以上 | `npm -v` |
| モダンブラウザ | Chrome 117+ / Edge 117+ | — |

> **注意**: カメラ API は **HTTPS または localhost** 上でのみ動作します。

### リモートトラッキングサーバー（オプション）

スマホなど非力な端末で使う場合、MediaPipe をサーバーに分離できます。

| ツール | 推奨バージョン | 確認コマンド |
|--------|--------------|------------|
| Python | 3.10 以上 | `python --version` |
| pip | 最新 | `pip --version` |

---

## インストール手順

### フロントエンド

#### 1. リポジトリのクローン（またはダウンロード）

```bash
git clone <リポジトリURL>
cd monocap-vrm
```

#### 2. 依存パッケージのインストール

```bash
npm install
```

| パッケージ | 役割 |
|-----------|------|
| `three` | 3D レンダリングエンジン |
| `@pixiv/three-vrm` | VRM モデルのロード・制御 |
| `@mediapipe/tasks-vision` | 顔・姿勢のリアルタイム推定（ローカルモード） |
| `kalidokit` | ランドマーク → VRM ボーン角度変換 |
| `vite` | 開発サーバー・バンドラー |

#### 3. 開発サーバー起動

```bash
npm run dev
```

`http://localhost:5173/monocap-vrm/` をブラウザで開く。

---

### リモートトラッキングサーバー（オプション）

#### 1. 仮想環境の作成（推奨）

```bash
cd server
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

#### 2. 依存パッケージのインストール

```bash
pip install -r requirements.txt
```

| パッケージ | 役割 |
|-----------|------|
| `mediapipe` | 顔・姿勢推定（Python ネイティブ実行） |
| `fastapi` | WebSocket サーバーフレームワーク |
| `uvicorn` | ASGI サーバー |
| `Pillow` / `numpy` | 画像処理 |

#### 3. サーバー起動

```bash
python main.py
```

初回起動時、MediaPipe のモデルファイル（数十 MB）を `server/models/` に自動ダウンロードします。

```
INFO:     Started server process
INFO:     Uvicorn running on http://0.0.0.0:8000
```

#### 4. ブラウザからリモートモードで接続

フロントエンドの URL に `?server=` パラメータを付加します。

```
# PC と同じ LAN 内のスマホから接続する例
http://<PCのIPアドレス>:5173/monocap-vrm/?server=ws://<PCのIPアドレス>:8000/ws

# ローカル確認（PC のブラウザで直接）
http://localhost:5173/monocap-vrm/?server=ws://localhost:8000/ws
```

ステータス欄が「リモートトラッキング中」に変われば接続完了です。

---

## ディレクトリ構成

```
monocap-vrm/
├── docs/                    # ドキュメント
│   ├── setup.md
│   ├── usage.md
│   ├── deploy.md
│   └── architecture.md
├── server/                  # リモートトラッキングサーバー（オプション）
│   ├── main.py              # FastAPI WebSocket サーバー
│   ├── requirements.txt
│   └── models/              # 初回起動時に自動生成・ダウンロード
│       ├── face_landmarker.task
│       └── pose_landmarker_lite.task
├── src/
│   ├── main.ts              # エントリポイント・UI イベント
│   ├── renderer.ts          # Three.js シーン・VRM ローダー
│   ├── tracker.ts           # MediaPipe ラッパー（ローカル・リモート両対応）
│   ├── rigger.ts            # ランドマーク → VRM ボーン適用
│   ├── camera.ts            # カメラ起動・停止
│   ├── skeleton.ts          # 骨格プレビュー描画
│   └── background.ts        # 背景設定 UI
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## トラブルシューティング

### `npm install` でエラーが出る

```bash
npm cache clean --force
npm install
```

### カメラが起動しない

- ブラウザのカメラ許可が「ブロック」になっていないか確認
- アドレスバーが `http://localhost:...` であることを確認（`file://` は不可）

### AI モデルの読み込みが遅い / 失敗する（ローカルモード）

- 初回起動時に CDN からモデルをダウンロードします（数十 MB）
- `cdn.jsdelivr.net` と `storage.googleapis.com` への通信が必要です

### サーバーに接続できない（リモートモード）

- `python main.py` が起動しているか確認
- PC のファイアウォールでポート 8000 が許可されているか確認
- PC とスマホが同じ Wi-Fi ネットワークにいるか確認
- スマホのブラウザのコンソールで WebSocket エラーを確認
