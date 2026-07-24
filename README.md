# AWS Amplify + PostgreSQL 構成

Deluge は「①②をPOSTするだけ」。判定・保存・学習はすべてこちら側で行います。

```
Zoho Desk（返信送信）
  │  POST /api/reviews  { ai_body, sent_body, prompt_version, ... }
  ▼
Amplify（Next.js / Lambda）
  │  diff計算 → §7の切り分け → 保存        ※LLMは呼ばない。常に高速
  ▼
PostgreSQL（runs / reviews / memories / proposals）
  │
  │  別処理でまとめて分析（レビューが5件溜まったら）
  ▼
④レビュー学習AI → メモリ修正案 → 承認画面
```

## セットアップ

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Amplify のコンソールで環境変数を設定してください。

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` |
| `HOOK_SECRET` | Deluge からの `X-Api-Key` |
| `OPENAI_API_KEY` | ④の分析でのみ使用 |
| `PG_POOL_MAX` | 既定2。増やさないこと（後述） |

**APIキーは Amplify の環境変数ではなく Secrets Manager / SSM Parameter Store に置いてください。** 環境変数はビルドログやコンソールから見えます。この案件では既にキーが2回漏れているので、ここは固めておく価値があります。

## Amplify（Lambda）固有の注意点

### 1. コネクションプール — 最重要

Amplify の SSR は Lambda で動きます。**同時実行数だけインスタンスが増え、それぞれがプールを持ちます。** `max: 10` にすると、同時実行30で300接続を要求してRDSが即死します。

- 1インスタンスあたり `max: 1〜2`
- `new Pool()` はモジュールスコープに置いてウォームスタート間で使い回す（`lib/pg.ts` で対応済み）
- 同時実行が増える見込みなら **RDS Proxy を挟んでください。** Lambda + RDS では実質必須です

### 2. Lambda のタイムアウト

`/api/reviews` はLLMを呼ばないので数十ミリ秒で返ります。問題ありません。

**問題は④の分析処理です。** OpenAIへの呼び出しで30〜60秒かかることがあり、Amplify のSSR Lambdaのタイムアウト上限に収まらない可能性があります。上限値は構成によって変わるので、実装前に確認してください。

超える場合の選択肢は3つです。

1. 別Lambda（EventBridge定期実行）に切り出す
2. Step Functions で非同期化
3. 分析を小分けにして複数回に分ける

MVP段階なら、まず画面のボタンから同期実行して実測し、収まらなければ1に移すのが早いです。

### 3. VPC 内のRDSに繋ぐ場合

Lambda を VPC に入れると、そのままでは OpenAI API に出られません。NAT Gateway か VPC Endpoint が必要です。**④の分析だけが外向き通信をするので、そこだけ別Lambdaに切り出せばVPC構成を単純にできます。**

RDS をパブリックサブネットに置いてIP制限、という手もありますが、会員の氏名を含むデータを持つので推奨しません。

### 4. `runtime = "nodejs"` の指定

`pg` はNode.jsランタイムが必要です。Edge Runtime では動きません。各 route.ts に `export const runtime = "nodejs";` を入れてあります。消さないでください。

## Deluge 側

これだけになります。

```javascript
payload = Map();
payload.put("ticket_id", ticketId.toString());
payload.put("staff_id", assigneeId.toString());
payload.put("ai_body", ai_body);
payload.put("sent_body", sent_body);
payload.put("prompt_id", prompt_id);
payload.put("prompt_version", prompt_version);
payload.put("model", "gpt-5.6");

headers = Map();
headers.put("Content-Type","application/json");
headers.put("X-Api-Key","<HOOK_SECRET>");

resp = invokeurl
[
	url :"https://<amplify-domain>/api/reviews"
	type :POST
	parameters:payload.toString()
	headers:headers
];
```

**ここで `payload.toString()` に戻せます。** 自前サーバー側で受けるので、Deluge のエスケープが多少崩れてもこちらで正規化できるためです。ただし念のため、本文のダブルクォートだけは Deluge 側で全角に置換しておくと安全です。

```javascript
ai_body = ai_body.replaceAll("\"","”");
sent_body = sent_body.replaceAll("\"","”");
```

Deluge で確定した制約（バックスラッシュが作れない、`"\\n"` が壊れる等）は、この構成では**もう踏みません。** JSONを手で組み立てる必要がなくなります。

## SQLite版からの主な変更

| | SQLite版 | PostgreSQL版 |
|---|---|---|
| 切り分け結果 | 分析時に都度計算 | **書き込み時に `fault` 列へ確定** |
| §7の指標 | アプリ側で集計 | `metrics_by_prompt_version` ビュー |
| 制約 | なし | `CHECK` で不正値を弾く |
| ID | アプリで uuid 生成 | `gen_random_uuid()` |

`fault` を保存時に確定させたのが実質的な改善です。判定はルールベースで決定的なので、DBに事実として残せます。**SQLでそのまま「判断ミス率」「生成ミス率」が出せるようになりました。**

## 残っている課題

- **課金** — 切り分けテストで「You exceeded your current quota」が出ています。これが解決しないと④の分析は動きません
- **`decision_ok`** — §3-4への追加が大山さん承認待ちのままです。無いと判断ミスの切り分け精度が落ちます
- **個人情報** — `runs.ai_body` / `reviews.sent_body` に会員名がそのまま入ります。RDSの暗号化を有効にし、§6-3の解釈を確定させてください
