# ローカルでの起動

Windows / PowerShell 前提で書いています。

---

## 1. Node.js のバージョン確認

```powershell
node -v
```

**Node 20 以上**が必要です（Next.js 15 の要件）。18系だと起動時か
ビルド時にエラーになります。

古い場合は https://nodejs.org から LTS を入れてください。

## 2. 依存のインストール

```powershell
cd C:\Users\ihsih\Documents\review_ai
npm install
```

`package-lock.json` が生成されます。**これはコミットしてください。**
無いと Amplify の `npm ci` が失敗します（`node_modules` は逆に
コミットしません）。

## 3. 環境変数

`.env.local` を作ります。Next.js が自動で読み込み、`.gitignore` にも
入っているのでコミットされません。

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

**いま必要なのは1行だけです。**

```
OPENAI_API_KEY=sk-...
```

`DATABASE_URL` は空のままで構いません。DB非依存のエンドポイントは
それでも動きます。

## 4. 起動

```powershell
npm run dev
```

```
▲ Next.js 15.x
- Local: http://localhost:3000
✓ Ready in 2.3s
```

## 5. 動作確認

ブラウザで順に開いてください。

| URL | 期待する結果 |
|---|---|
| http://localhost:3000 | 設定状態とエンドポイント一覧 |
| http://localhost:3000/api/ping | `{"ok":true,...}` |
| http://localhost:3000/api/review | **レビュー結果のJSON** |

`/api/review` は引数なしでサンプル（`承知いたしました。` →
`承知しました(^^♪`）を実行します。

### PowerShell から叩く場合

```powershell
curl.exe http://localhost:3000/api/review
```

**`curl` ではなく `curl.exe` と書いてください。** PowerShell の `curl`
は `Invoke-WebRequest` の別名で、挙動が違います。

見やすくするなら：

```powershell
curl.exe -s http://localhost:3000/api/review | ConvertFrom-Json | ConvertTo-Json -Depth 10
```

### POST の確認

```powershell
$body = @{
  ai_body   = "承知いたしました。"
  sent_body = "承知しました(^^♪"
} | ConvertTo-Json

curl.exe -s -X POST http://localhost:3000/api/review `
  -H "Content-Type: application/json" `
  -d $body
```

---

## DB を使う画面を試す場合

`DATABASE_URL` を `.env.local` に足し、スキーマを流します。

```powershell
psql "$env:DATABASE_URL" -f db/schema.sql
psql "$env:DATABASE_URL" -f db/002_messages.sql
```

`psql` が無ければ PostgreSQL クライアントを入れるか、pgAdmin や
DBeaver で SQL ファイルの中身を実行してください。

ローカルで手軽に試すなら Docker が早いです。

```powershell
docker run --name review-ai-db -e POSTGRES_PASSWORD=devpass -p 5432:5432 -d postgres:16
```

```
DATABASE_URL=postgres://postgres:devpass@localhost:5432/postgres
PGSSL=disable
```

**`PGSSL=disable` を忘れないでください。** ローカルの Postgres は
SSL を有効にしていないため、既定のままだと接続に失敗します。

その後：

```powershell
npm run seed          # ダミーレビュー7件を投入
```

http://localhost:3000/proposals で「振り返りを実行」を押すと ④ が
動きます（`OPENAI_API_KEY` と課金が必要）。

---

## よくある詰まりどころ

| 症状 | 原因 |
|---|---|
| `Cannot find module 'next'` | `npm install` をしていない |
| `/api/review` が 404 | ファイルが無い。`dir app\api\review` で確認 |
| `OPENAI_API_KEY が未設定です` | `.env.local` を作った後、`npm run dev` を再起動していない |
| `/proposals` でエラー画面 | `DATABASE_URL` 未設定。想定内の動作です |
| `curl` の挙動がおかしい | `curl.exe` と書く |

**環境変数を変えたら `npm run dev` を再起動してください。** ホット
リロードでは反映されません。

---

## ローカルとAmplifyの違い

ローカルで動いても Amplify で落ちることがあります。これまでに
実際に起きたものです。

| 項目 | ローカル | Amplify |
|---|---|---|
| `serverExternalPackages` | 効かない（node_modules がある）| **Lambda に同梱されず落ちる** |
| 環境変数 | `.env.local` | コンソールで設定 + **再デプロイが必要** |
| DBへの到達 | 直接繋がる | VPC・セキュリティグループ次第 |

**ローカルで通ったら、そのままコミットして Amplify のログを見る**、
という順番で進めるのが確実です。
