# デプロイ手順

## 推奨デプロイ方法

**GitHub Pages + GitHub Actions** を推奨します。

| 観点             | 理由                                                    |
| ---------------- | ------------------------------------------------------- |
| 無料             | パブリックリポジトリなら完全無料                        |
| 自動化           | `main` に push するだけで再デプロイ                     |
| HTTPS            | デフォルトで HTTPS 提供（MediaPipe の動作要件を満たす） |
| 追加サービス不要 | GitHub 以外のアカウント登録が不要                       |

独自ドメインを使いたい場合や `github.io` のサブパス設定を避けたい場合は [Netlify](#netlify) が次点の選択肢です。

---

## 1. 本番ビルド

```bash
npm run build
```

`dist/` ディレクトリに静的ファイル（HTML / JS / CSS）が出力されます。

```bash
# ビルド結果をローカルで確認
npm run preview
```

> **必須**: MediaPipe は WebGPU / WebAssembly を使用するため、**HTTPS 環境**でのみ動作します。  
> `localhost` は例外として HTTP でも動作しますが、本番デプロイは必ず HTTPS にしてください。

---

## 2. デプロイ先別の手順

### GitHub Pages（推奨）

#### 初回セットアップ

**Step 1: `vite.config.ts` を作成してベースパスを設定**

GitHub Pages のデフォルト URL は `https://<user>.github.io/<repo>/` とサブパスになるため、ベースパス設定が必須です。

```typescript
// vite.config.ts（プロジェクトルートに新規作成）
import { defineConfig } from "vite";

export default defineConfig({
  base: "/monocap-vrm/",
});
```

**Step 2: GitHub リポジトリの Pages 設定を変更**

リポジトリページ → **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に変更。

> ブランチ選択などは不要です。ワークフローが直接デプロイします。

**Step 3: GitHub Actions のワークフローを作成**

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

**Step 4: コミットして push**

```bash
git add vite.config.ts .github/workflows/deploy.yml
git commit -m "GitHub Pages デプロイ設定追加"
git push origin main
```

push 後、Actions タブで緑チェックが出たら `https://<user>.github.io/monocap-vrm/` でアクセス可能になります。

#### 2回目以降のデプロイ

`main` ブランチに push するだけで自動的に再ビルド・デプロイされます。

```bash
git push origin main  # これだけで OK
```

#### 手動デプロイ（CI を使わない場合）

```bash
npm install -D gh-pages
npm run build
npx gh-pages -d dist
```

---

### Netlify

独自ドメインを使いたい場合や `vite.config.ts` のベースパス設定を避けたい場合の次点選択肢です。`base` の設定は不要で、`dist/` をそのままデプロイできます。

**Netlify CLI を使う場合**

```bash
npm install -g netlify-cli
npm run build
netlify deploy --prod --dir=dist
```

**Netlify ダッシュボードから手動デプロイ**

1. [app.netlify.com](https://app.netlify.com) にログイン
2. **Add new site → Deploy manually** を選択
3. `dist/` フォルダをドラッグ&ドロップ

**netlify.toml（リポジトリ連携時の設定）**

```toml
[build]
  command   = "npm run build"
  publish   = "dist"
```

---

### Vercel

**Vercel CLI を使う場合**

```bash
npm install -g vercel
npm run build
vercel --prod
```

CLI の質問には以下を入力：

| 質問                      | 入力値                       |
| ------------------------- | ---------------------------- |
| Set up and deploy?        | `Y`                          |
| Which scope?              | 対象のチーム／個人アカウント |
| Link to existing project? | `N`（初回）                  |
| Build command?            | `npm run build`              |
| Output directory?         | `dist`                       |

**vercel.json（リポジトリ連携時の設定）**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

---

### 自前サーバー（nginx）

```bash
# ビルド
npm run build

# dist/ をサーバーにコピー
scp -r dist/* user@your-server:/var/www/monocap-vrm/
```

nginx 設定例：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example.com;

    root /var/www/monocap-vrm;
    index index.html;

    # SPA: すべてのルートを index.html にフォールバック
    location / {
        try_files $uri $uri/ /index.html;
    }

    # キャッシュ設定（ハッシュ付きアセットは長期キャッシュ）
    location ~* \.(js|css|woff2|png|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SSL 設定（Let's Encrypt 等）
    ssl_certificate     /etc/letsencrypt/live/your-domain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.example.com/privkey.pem;
}
```

---

## 3. 注意事項

### MediaPipe モデルファイルのキャッシュ

初回アクセス時に `cdn.jsdelivr.net` および `storage.googleapis.com` から MediaPipe のモデルファイル（数十 MB）をダウンロードします。  
プロキシ環境や社内ネットワークからアクセスする場合はこれらのドメインへの通信を許可してください。

### CORS ヘッダー

VRM ファイルをユーザーのローカルから読み込む仕様のため、CORS の設定は不要です。  
ただし、サーバー上に VRM ファイルを置いて読み込ませる場合は適切な CORS 設定が必要です。

### SharedArrayBuffer（将来の拡張向け）

WebAssembly スレッドを使う場合は以下のレスポンスヘッダーが必要になります（現在は不要）：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
