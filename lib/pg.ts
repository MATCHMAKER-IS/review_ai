import { Pool } from "pg";
import type { PoolClient, QueryResultRow } from "pg";

/**
 * PostgreSQL 接続。
 *
 * ★ 接続は「最初のクエリ実行時」まで遅延します。
 *
 *   next build はページやルートのモジュールを読み込んでメタデータを
 *   収集します。モジュール読み込み時に DATABASE_URL を要求すると、
 *   ビルド段階で例外になり Amplify のデプロイが落ちます。
 *   環境変数はランタイムにしか無い前提で設計してください。
 *
 * ★ Amplify の SSR は Lambda 上で動きます。ここが最大の落とし穴です。
 *
 *  - Lambda は同時実行数だけインスタンスが増えます。各インスタンスが
 *    プールを持つので、max を大きくすると RDS の接続上限を簡単に超えます。
 *    1インスタンスあたり max: 1〜2 に抑えるのが鉄則です。
 *  - globalThis に載せてウォームスタート間で使い回します。
 *    リクエストごとに new Pool すると接続が枯渇します。
 *  - 本番で同時実行が増えるなら RDS Proxy を挟んでください。
 *    Lambda + RDS では実質必須です。
 */

const g = globalThis as unknown as { __pgPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL が未設定です。Amplify コンソールの環境変数を確認してください。",
    );
  }

  return new Pool({
    connectionString,
    // Lambda 1インスタンスあたりの上限。増やさないこと。
    max: Number(process.env.PG_POOL_MAX ?? 2),
    // アイドル接続を長く抱えない。Lambdaは凍結されるため。
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    // RDS は既定でSSL必須。自己署名CAなので rejectUnauthorized は false。
    // 証明書検証をしたい場合は AWS のCAバンドルを ca に渡してください。
    ssl:
      process.env.PGSSL === "disable" ? undefined : { rejectUnauthorized: false },
  });
}

/** 遅延初期化。ここが呼ばれるまで接続もDATABASE_URLの検証もしません。 */
export function getPool(): Pool {
  if (!g.__pgPool) g.__pgPool = createPool();
  return g.__pgPool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** トランザクション。失敗したら必ずROLLBACKして接続を返します。 */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** CLIスクリプト用。Lambda上では呼ばないでください。 */
export async function endPool(): Promise<void> {
  if (g.__pgPool) {
    await g.__pgPool.end();
    g.__pgPool = undefined;
  }
}
