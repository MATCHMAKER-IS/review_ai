# デバッグ

## 1. VS Code でブレークポイント（推奨）

`.vscode/launch.json` を同梱しています。

1. VS Code でプロジェクトを開く
2. `route.ts` や `lib/review.ts` の行番号の左をクリックして赤丸を置く
3. **F5** を押す →「Next.js: サーバー側をデバッグ」を選ぶ
4. 別のターミナルからリクエストを投げる

```powershell
curl.exe -s -X POST http://localhost:3000/api/review `
  -H "Content-Type: application/json" `
  -d '{\"ticket_id\":\"T1\",\"message\":\"テスト\",\"type\":\"ai\"}'
```

リクエストが届いた瞬間に止まります。

**止めどころとして有効な場所：**

| ファイル | 行の目安 | 見えるもの |
|---|---|---|
| `app/api/review/route.ts` | `const ticketId = str(...)` の直後 | 受け取ったパラメータ |
| `lib/messages.ts` | `evaluate(...)` の中 | 差分計算と切り分けの結果 |
| `lib/review.ts` | `await fetch(API_URL...)` の直前 | **OpenAIへ送るボディの実物** |
| `lib/review.ts` | `const data = await res.json()` の直後 | OpenAIからの生レスポンス |

3番目が特に有用です。今回の `json` キーワード不足のようなエラーは、
送信ボディを目で見れば即座に分かります。

## 2. Chrome DevTools を使う場合

VS Code を使わないなら、Node のインスペクタを有効にします。

```powershell
$env:NODE_OPTIONS="--inspect"
npm run dev
```

Chrome で `chrome://inspect` を開き、「Remote Target」の
`inspect` をクリックすると DevTools が開きます。Sources タブから
ファイルを探してブレークポイントを置けます。

**PowerShell では `NODE_OPTIONS=--inspect npm run dev` と書けません。**
`$env:` で先に設定してください。設定はそのターミナルセッション内だけ
有効です。

## 3. `debugger` 文を書く

一時的に止めたいだけならこれが早いです。

```typescript
export async function POST(req: Request) {
  const body = await req.json();
  debugger;   // ← インスペクタが有効なときだけ止まる
  ...
}
```

**コミット前に消してください。** インスペクタ無しでは無視されるので
本番でも止まりませんが、残しておく理由もありません。

## 4. Amplify（Lambda）ではブレークポイントを使えません

デプロイ後のコードにデバッガを繋ぐ手段はありません。**`console.log`
と CloudWatch Logs が唯一の手段です。**

```typescript
console.log("[review] body:", JSON.stringify(body).slice(0, 500));
```

ログの場所：

```
CloudWatch Logs → ロググループ → /aws/amplify/<アプリID>
```

`Digest: xxxxx` のようなエラーIDが画面に出た場合、その文字列で
検索すると対応するスタックトレースが見つかります。**Next.js が
本番でエラーを隠しているだけで、ログには完全な内容が残っています。**

### ログに出してはいけないもの

会員の氏名・連絡先を含む本文をそのまま `console.log` すると、
CloudWatch に平文で残ります（§6-3）。

```typescript
// 悪い例
console.log("[review]", body.message);

// 良い例
console.log("[review]", {
  ticket_id: body.ticket_id,
  type: body.type,
  length: String(body.message ?? "").length,
});
```

**長さや件数だけ出せば、たいていの調査には足ります。**

## 5. ローカルで再現しない問題がある

これまでに実際に起きたものです。**どれもローカルでは再現しません
でした。**

| 問題 | ローカル | Amplify |
|---|---|---|
| `serverExternalPackages: ["pg"]` | 動く | Lambdaに同梱されず落ちる |
| 環境変数の未設定 | `.env.local` があれば動く | 設定後に再デプロイが必要 |
| ファイルの未コミット | 手元にあるので動く | 404になる |

ローカルのデバッグで追えるのは**ロジックの誤り**までです。
デプロイ環境固有の問題は CloudWatch を見るしかありません。
