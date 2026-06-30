# デプロイ手順

## 構成の整理

このアプリは「フロントエンド（静的サイト）」と「トラッキングサーバー（オプション）」の2つに分かれます。

| コンポーネント | 役割 | 必須か |
|--------------|------|--------|
| フロントエンド | Three.js VRM 描画 + UI | 必須 |
| トラッキングサーバー | MediaPipe 推論（Python） | スマホ向け最適化時のみ |

ローカルトラッキング（従来動作）はフロントエンドだけで完結します。

---

## フロントエンドのデプロイ

### 推奨: GitHub Pages + GitHub Actions

| 観点 | 理由 |
|------|------|
| 無料 | パブリックリポジトリなら完全無料 |
| 自動化 | `master` に push するだけで再デプロイ |
| HTTPS | デフォルトで HTTPS（カメラ API の動作要件を満たす） |

#### セットアップ手順

**Step 1: GitHub リポジトリの Pages 設定を変更**

リポジトリ → **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に変更。

**Step 2: ワークフローを作成**

```bash
mkdir -p .github/workflows
```

`.github/workflows/deploy.yml` を作成：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [master]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

**Step 3: push**

```bash
git add .github/workflows/deploy.yml
git commit -m "GitHub Pages デプロイ設定追加"
git push origin master
```

push 後、Actions タブで緑チェックが出たら `https://<user>.github.io/monocap-vrm/` でアクセス可能になります。

以降は `master` に push するだけで自動デプロイされます。

---

### Netlify

独自ドメインを使いたい場合や `base` のサブパス設定を避けたい場合の次点選択肢です。

```bash
npm install -g netlify-cli
npm run build
netlify deploy --prod --dir=dist
```

リポジトリ連携時の `netlify.toml`：

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

---

### Vercel

```bash
npm install -g vercel
npm run build
vercel --prod
```

`vercel.json`：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

---

### 自前サーバー（nginx）

```bash
npm run build
scp -r dist/* user@your-server:/var/www/monocap-vrm/
```

nginx 設定例：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example.com;

    root /var/www/monocap-vrm;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|woff2|png|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    ssl_certificate     /etc/letsencrypt/live/your-domain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.example.com/privkey.pem;
}
```

---

## トラッキングサーバーのデプロイ

> **用途**: スマホなど非力な端末で MediaPipe 推論をオフロードする場合のみ必要です。

### パターン A: LAN 内の PC で実行（推奨）

最もシンプルで低遅延な構成です。PC とスマホが同じ Wi-Fi に繋がっていれば動作します。

```bash
cd server
pip install -r requirements.txt
python main.py
```

スマホのブラウザで以下にアクセス：

```
http://<PCのIPアドレス>:5173/monocap-vrm/?server=ws://<PCのIPアドレス>:8000/ws
```

> フロントエンドを GitHub Pages にデプロイしている場合、スマホから HTTPS でアクセスすることになります。  
> **HTTPS のページから `ws://` （非暗号化 WebSocket）への接続はブラウザにブロックされます。**  
> この場合はサーバーも WSS 化するか、フロントエンドも `http://` でアクセスしてください（LAN 内であれば HTTP で OK）。

---

### パターン B: VPS / クラウドサーバーで実行

インターネット越しにアクセスさせたい場合の構成です。

> **注意**: ネットワーク往復遅延（50〜200ms）が加わるため、アバターの動きにワンテンポのラグが出ます。LAN 内利用（パターン A）の方が快適です。

#### サーバーへの配置

```bash
# サーバーに server/ ディレクトリを転送
scp -r server/ user@your-server:~/monocap-vrm-server/

ssh user@your-server
cd ~/monocap-vrm-server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

#### systemd で常駐化

```ini
# /etc/systemd/system/monocap-tracker.service
[Unit]
Description=MonoCapVRM Tracking Server
After=network.target

[Service]
User=your-user
WorkingDirectory=/home/your-user/monocap-vrm-server
ExecStart=/home/your-user/monocap-vrm-server/.venv/bin/python main.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now monocap-tracker
```

#### nginx で WSS（WebSocket over TLS）をプロキシ

HTTPS のフロントエンドから接続するには WSS が必要です。

```nginx
server {
    listen 443 ssl;
    server_name tracker.your-domain.example.com;

    ssl_certificate     /etc/letsencrypt/live/tracker.your-domain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tracker.your-domain.example.com/privkey.pem;

    location /ws {
        proxy_pass http://127.0.0.1:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

接続 URL：

```
https://your-frontend.github.io/monocap-vrm/?server=wss://tracker.your-domain.example.com/ws
```

---

## 注意事項

### MediaPipe モデルファイルのキャッシュ（ローカルモード）

初回アクセス時に `cdn.jsdelivr.net` および `storage.googleapis.com` からモデルを DL します。  
プロキシ環境ではこれらのドメインへの通信を許可してください。

### CORS

VRM ファイルはローカルから読み込む仕様のため CORS 設定は不要です。  
サーバー上に VRM を置く場合のみ適切な CORS 設定が必要です。  
トラッキングサーバー（`server/main.py`）は `allow_origins=["*"]` で全オリジンを許可済みです。

### `server/models/` は `.gitignore` に追加推奨

モデルファイルは数十 MB あるため、リポジトリには含めないことを推奨します。

```gitignore
server/models/
server/.venv/
```
