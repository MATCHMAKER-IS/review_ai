export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * トップページ。
 *
 * ★ このファイルは lib/pg を import しません。
 *   DBが未設定でも必ず表示できるようにするためです。
 *   ここに import を足すと、DB障害時に全画面が落ちます。
 */

const ENDPOINTS: Array<{
  path: string;
  label: string;
  note: string;
  db: boolean;
}> = [
  {
    path: "/api/ping",
    label: "生存確認",
    note: "依存ゼロ。ここが落ちたら Lambda 自体が起動していない",
    db: false,
  },
  {
    path: "/review",
    label: "レビュー実行",
    note: "引数なしでサンプル実行。OpenAI までの経路を単独で確認できる",
    db: false,
  },
  {
    path: "/api/diag",
    label: "設定診断",
    note: "環境変数とテーブルの有無をまとめて返す",
    db: true,
  },
  {
    path: "/api/health",
    label: "DB接続確認",
    note: "接続だけを確認する",
    db: true,
  },
  {
    path: "/proposals",
    label: "メモリ提案の承認画面",
    note: "④が出した修正案を承認・却下する",
    db: true,
  },
];

export default function Home() {
  const openaiReady = Boolean(process.env.OPENAI_API_KEY);
  const dbReady = Boolean(process.env.DATABASE_URL);

  return (
    <main>
      <div className="card">
        <h2>設定の状態</h2>
        <div className="stats">
          <div>
            <div className="n">{openaiReady ? "設定済" : "未設定"}</div>
            <div className="l">OPENAI_API_KEY</div>
          </div>
          <div>
            <div className="n">{dbReady ? "設定済" : "未設定"}</div>
            <div className="l">DATABASE_URL</div>
          </div>
        </div>
        {!dbReady && (
          <div className="banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
            DATABASE_URL が未設定です。DBを使う画面とAPIは動きません。
            レビュー処理（<code>/review</code>）はDB非依存なので、
            この状態でも動作確認できます。
          </div>
        )}
        {!openaiReady && (
          <div className="banner warn" style={{ marginTop: 10, marginBottom: 0 }}>
            OPENAI_API_KEY が未設定です。<code>/review</code> は差分と切り分けまでは
            返しますが、ルールの言語化は行われません。
          </div>
        )}
      </div>

      <div className="card">
        <h2>エンドポイント</h2>
        <ul className="memlist" style={{ listStyle: "none", paddingLeft: 0 }}>
          {ENDPOINTS.map((e) => (
            <li key={e.path} style={{ marginBottom: 12 }}>
              <a href={e.path} className="mono" style={{ fontSize: 14 }}>
                {e.path}
              </a>
              {e.db && (
                <span
                  className="kind retire"
                  style={{ marginLeft: 8, fontSize: 11 }}
                >
                  DB必要
                </span>
              )}
              <div className="note">
                {e.label} — {e.note}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>切り分けの順番</h2>
        <ol className="memlist">
          <li>
            <code>/api/ping</code> が通るか — 通らなければ Lambda
            が起動していない
          </li>
          <li>
            <code>/review</code> が通るか — OpenAI
            までの経路。ここまではDB不要
          </li>
          <li>
            <code>/api/diag</code> — 環境変数とテーブルの状態
          </li>
          <li>
            <code>/proposals</code> — ④の承認画面
          </li>
        </ol>
      </div>
    </main>
  );
}
