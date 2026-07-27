# PostgreSQL（RDS）の準備

DB接続の作り込みは後回しにする前提で、**先に用意しておくべきもの**をまとめます。
この手順を済ませておけば、`DATABASE_URL` を環境変数に入れるだけで動きます。

---

## 1. RDS インスタンスの作成

Amplify（Lambda）から接続する前提での推奨設定です。

| 項目 | 推奨 | 理由 |
|---|---|---|
| エンジン | PostgreSQL 15 以降 | `gen_random_uuid()` に pgcrypto を使用 |
| インスタンス | db.t4g.micro | MVPには十分。後から変更可 |
| ストレージ | 20GB gp3 | 本文を保存するが件数は少ない |
| Multi-AZ | 不要 | MVP段階では過剰 |
| **暗号化** | **有効** | 会員の氏名を含む本文を保存するため |
| 自動バックアップ | 7日 | 既定のまま |
| パブリックアクセス | **無効を推奨** | 下記「接続方式」参照 |

**暗号化は作成時にしか有効化できません。** 後から変えられないので、
ここだけは最初に決めてください。§6-3 の個人情報の扱いに関わります。

## 2. 接続方式を決める

Lambda から RDS への接続には3つの選択肢があり、**OpenAI への外向き通信と
トレードオフの関係にあります。**

### A. RDS をパブリックにする（最も簡単・非推奨）

- Lambda は VPC 外のまま。OpenAI にそのまま出られる
- RDS のセキュリティグループで接続元IPを絞る必要がある
- **Lambda のIPは固定されないため、実質「どこからでも接続可」になります**
- 会員の氏名を含むDBをこの状態に置くのは避けてください

### B. Lambda を VPC に入れる（推奨）

- RDS はプライベートサブネット。外部から到達不可
- **ただし Lambda も外に出られなくなり、OpenAI を呼べません**
- NAT Gateway か VPC Endpoint が必要（NAT は月額がかかります）

### C. B + 分析だけ切り出す（構成は複雑だが合理的）

- 外向き通信をするのは ④ の分析処理だけです
- API（`/api/messages` 等）は VPC 内、分析は VPC 外の別 Lambda
- NAT が不要になり、攻撃面も小さくなります

**MVP段階では B で始めて、NAT のコストが気になったら C に移す**のが
現実的だと思います。

## 3. セキュリティグループ

Lambda から RDS への 5432 番を許可します。

```
RDS のセキュリティグループ
  インバウンド: PostgreSQL (5432)
  ソース: Lambda のセキュリティグループ（IPではなくSG指定）
```

**IPではなくセキュリティグループを指定してください。** Lambda のIPは
変動するため、IP指定では動いたり動かなかったりします。

## 4. 接続文字列

```
postgres://<user>:<password>@<endpoint>:5432/<dbname>
```

**パスワードに記号が含まれる場合はURLエンコードが必要です。**
`@` `:` `/` `#` `?` などをそのまま書くと解釈がずれます。

```
password: p@ss:w0rd
→          p%40ss%3Aw0rd
```

RDS 作成時にパスワードを自動生成すると記号が入りやすいので、
ここは実際に接続して確かめてください。

## 5. スキーマの適用

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/002_messages.sql
```

VPC 内の RDS には手元から直接繋げないため、次のいずれかで実行します。

- 踏み台（EC2）経由の SSH トンネル
- Session Manager のポートフォワーディング
- 一時的にパブリックアクセスを有効化して流し、すぐ戻す

**作成されるテーブルは7つです。**
`runs` / `reviews` / `memories` / `memory_versions` / `proposals` /
`rule_usage` / `messages`

適用後は `/api/diag` で確認できます。

```json
{ "ok": true, "tables_found": 7 }
```

## 6. コネクション数

Amplify の SSR は Lambda で動き、**同時実行数だけインスタンスが増えます。**
各インスタンスがプールを持つため、接続数はすぐ膨らみます。

- `PG_POOL_MAX=2` のまま運用してください
- db.t4g.micro の `max_connections` はおよそ 80〜100 です
- 同時実行が40を超える見込みなら **RDS Proxy を挟んでください**

コーディネーターが数名、Desk のワークフロー起点という規模なら、
当面は RDS Proxy 無しで足ります。

## 7. Amplify の環境変数

| 変数 | 例 | 備考 |
|---|---|---|
| `DATABASE_URL` | `postgres://...` | **Secrets Manager 推奨** |
| `HOOK_SECRET` | 任意の長い文字列 | Deluge からの `X-Api-Key` |
| `OPENAI_API_KEY` | `sk-...` | **Secrets Manager 推奨** |
| `PG_POOL_MAX` | `2` | 増やさないこと |

**環境変数を追加したら再デプロイが必要です。** 保存しただけでは
反映されません。

Amplify の環境変数はコンソールとビルドログから見えます。この案件では
既にキーが2回漏れているので、`DATABASE_URL` と `OPENAI_API_KEY` は
SSM Parameter Store か Secrets Manager に置くことを勧めます。

---

## いま動かせるもの / 動かせないもの

DB が未設定でも次は動きます。

| 動く | 内容 |
|---|---|
| `/` | 設定状態の表示 |
| `/api/ping` | 生存確認 |
| `/api/review` | **レビュー実行。OpenAI までの経路を単独で確認できる** |

DB が必要なもの。

| DB必要 | 内容 |
|---|---|
| `/api/messages` | Desk からの受け口 |
| `/api/diag` `/api/health` | 接続確認 |
| `/proposals` | ④の承認画面 |
| `/api/learning/analyze` | ④の分析 |
