# Zoho Desk 側のコード

Amplify の API を叩くだけの2本です。Desk のカスタム関数として登録し、
それぞれ別のワークフローに紐づけてください。

| ファイル | トリガー | 送るもの |
|---|---|---|
| `desk_post_ai_draft.deluge` | 下書き作成時（既存の返信生成ワークフローに追記） | `kind: "ai"` |
| `desk_post_sent_reply.deluge` | チケットへの返信が送信されたとき（新規ワークフロー） | `kind: "sent"` |

## 置き換える箇所

- `https://<amplify-domain>` → Amplify のドメイン
- `<HOOK_SECRET>` → Amplify の環境変数に設定した値
- `prompt_version` → OpenAI 管理画面で確認した現在の版

## 注意

**2本目が無いと `sent_body` が永久に集まらず、④は何も学習できません。**
下書きを送るだけでは片手落ちです。

Deluge から直接 OpenAI を叩く旧方式のスクリプトは同梱していません。
40秒のタイムアウトとエスケープ処理の問題で断念した経緯があるため、
再利用しないでください（詳細は `../HANDOFF.md` §4）。
