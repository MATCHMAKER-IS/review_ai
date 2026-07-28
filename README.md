# レビューAI 受信API

Zoho Desk から AIの下書きと送信済みの文面を受け取り、PostgreSQL に
保存します。エンドポイントは **`/api/review` の1本だけ**です。

---

## API

### POST /api/review

```
X-Api-Key: <HOOK_SECRET>
Content-Type: application/json

{
  "ticket_id": "1234567",   必須  問い合わせID
  "message":   "本文",       必須  メッセージ内容
  "type":      "ai",         必須  "ai"（AI下書き）/ "sent"（送信済み）
  "staff_id":  "890123",     任意  担当ユーザーのID
  "memory":    7             任意  メモリのバージョン番号
}
```

ai と sent は別々に届きます。届くたびに次を行います。

1. 受信メッセージを1行保存（`review_messages`）
2. 同じ ticket_id に ai と sent が揃ったか確認
3. 揃っていれば **OpenAI で差異を判定**
4. 判定結果を保存（`review_judgments`）

**レスポンスは成功か失敗かだけを返します。**

```json
{ "result": "success" }
```

```json
{ "result": "error", "code": "missing_fields", "message": "…" }
```

判定の中身（差分・切り分け・要約）は `review_judgments` テーブルに
保存され、レスポンスには含めません。ai だけ届いた段階（ペア未成立）でも、
保存に成功していれば `success` を返します。

### POST 以外

**POST 専用です。** GET / PUT / PATCH / DELETE は 405 を返します。

### 失敗レスポンス

```json
{ "result": "error", "code": "...", "message": "..." }
```

| code | HTTP | 意味 |
|---|---|---|
| `method_not_allowed` | 405 | POST 以外でアクセスした |
| `unauthorized` | 401 | `X-Api-Key` が一致しない |
| `invalid_json` | 400 | ボディをJSONとして解釈できない |
| `missing_fields` | 400 | 必須項目が不足（`detail.missing`） |
| `internal_error` | 500 | それ以外（DB接続失敗など） |

**Deluge 側は `code` で分岐してください。** `message` の文言は
変わりえます。

---

## テーブル

2つです。

### review_messages（受信ログ）

| 列 | 型 | 内容 |
|---|---|---|
| `id` | UUID | レコードID |
| `ticket_id` | TEXT | 問い合わせID |
| `message` | TEXT | メッセージ内容 |
| `type` | TEXT | ai / sent |
| `staff_id` | TEXT | 担当ユーザーのID |
| `memory_version` | INTEGER | メモリのバージョン番号 |
| `received_at` | TIMESTAMPTZ | 受信日時 |
| `updated_at` | TIMESTAMPTZ | DB更新日時（トリガーで自動） |

### review_judgments（判定結果・1チケット1件）

| 列 | 型 | 内容 |
|---|---|---|
| `id` | UUID | レコードID |
| `ticket_id` | TEXT | 問い合わせID（UNIQUE） |
| `staff_id` / `memory_version` | | ai 側の値 |
| `ai_message` / `sent_message` | TEXT | 突き合わせた文面の控え |
| `has_diff` | BOOLEAN | 差異があるか |
| `diff_ratio` | NUMERIC | 修正量（0〜1） |
| `fault` | TEXT | §7の切り分け |
| `fault_reason` | TEXT | 切り分けの理由 |
| `diff_summary` | TEXT | 差異の要約（OpenAI） |
| `analysis` | JSONB | 差分・文体ルール候補（OpenAI） |
| `model` / `review_prompt_version` / `openai_response_id` | | 実行時の版情報 |
| `openai_error` | TEXT | OpenAI失敗時の理由 |
| `judged_at` / `updated_at` | TIMESTAMPTZ | 判定日時 / 更新日時 |

再送で sent が更新された場合、同じ ticket_id の判定は上書きされます。

---

## セットアップ

```bash
psql "$DATABASE_URL" -f db/schema.sql
# 既にテーブルがある場合は差分だけ:
psql "$DATABASE_URL" -f db/002_add_diff_columns.sql
psql "$DATABASE_URL" -f db/003_add_openai_raw.sql
psql "$DATABASE_URL" -f db/004_add_comments.sql
```

環境変数（Amplify コンソール）:

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` |
| `HOOK_SECRET` | Deluge からの `X-Api-Key` |
| `PG_POOL_MAX` | 既定2。増やさないこと |

**環境変数を変えたら再デプロイが必要です。**

---

## ローカルでの確認

```bash
npm install
cp .env.example .env.local     # DATABASE_URL を書く
npm run dev
npm run seed                    # ai→sent を2組投入
```

詳細は `DEV.md`、RDSの準備は `db/SETUP.md`、デバッグは `DEBUG.md`。

---

## いま使っていないファイル

`lib/` に判定ロジック（diff・切り分け）と ④レビュー学習AI の分析が
入っていますが、**現在の `/api/review` からは参照していません。**
保存に特化した今の仕様では不要ですが、次の段階（差分の分析・メモリ更新）
で使うため残しています。

```
lib/store.ts              ← いま使っているのはこれと lib/pg.ts だけ
lib/pg.ts

lib/diff.ts               差分計算（後で使う）
lib/messages.ts           突き合わせ＋判定（後で使う）
lib/review.ts             OpenAI呼び出し（後で使う）
lib/learning/*            ④の分析（後で使う）
lib/db.ts / openai.ts / types.ts
```

不要なら削除して構いません。
