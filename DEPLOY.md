# デプロイ手順

## 1. ファイルをリポジトリのルートに置く

ZIPを展開すると `review_ai/` フォルダができます。**その中身を**
リポジトリのルートに置いてください。フォルダごと入れると
`review_ai/review_ai/app/` になり、Amplify が app を見つけられません。

正しい状態：

```
<リポジトリのルート>/
  app/
  lib/
  db/
  scripts/
  deluge/
  package.json
  amplify.yml
  tsconfig.json
  next.config.mjs
```

## 2. コミット前に必ず確認する

```bash
git status
git ls-files | grep '^app/'
```

**`app/` 配下のファイルが出てこなければコミットされていません。**
Amplify は `Couldn't find any pages or app directory` で落ちます。

`.gitignore` に弾かれていないかの確認：

```bash
git check-ignore -v app/page.tsx
```

何か出力されたら、その `.gitignore` の行が原因です。リポジトリに
元から別の `.gitignore` があると、`app` や `build` を除外している
ことがあります。

強制的に追加する場合：

```bash
git add -A -f app lib db
```

ただし **なぜ無視されていたかは確認してください。** `.gitignore` を
直さないと次回も同じことが起きます。

## 3. package-lock.json をコミットする

```bash
npm install
git add package-lock.json
```

無いと `npm ci` が失敗します。`node_modules/` はコミットしません
（この2つは混同しやすいですが、扱いが逆です）。

## 4. Amplify の環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` |
| `HOOK_SECRET` | Deluge からの `X-Api-Key` |
| `OPENAI_API_KEY` | ④の分析でのみ使用 |
| `PG_POOL_MAX` | 既定2。増やさないこと |

**`DATABASE_URL` の設定漏れはビルドでは検知できません。** 接続を
遅延初期化しているため、`/api/health` を叩いて初めて分かります。

## 5. デプロイ後の確認順

1. `https://<domain>/api/health` → DB接続を確認
2. `psql "$DATABASE_URL" -f db/schema.sql`
3. `psql "$DATABASE_URL" -f db/002_messages.sql`
4. `/api/messages` に `kind:"ai"` → `kind:"sent"` の順でPOSTし
   `paired: true` が返るか確認

## 6. amplify.yml の診断行について

preBuild の先頭にファイル一覧を出す3行が入っています。構成が
落ち着いたら消して構いません。
