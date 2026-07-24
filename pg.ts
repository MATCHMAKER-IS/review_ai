import { Pool } from "pg";
import type { PoolClient, QueryResultRow } from "pg";

/**
 * PostgreSQL 接続。
 *
 * ★ Amplify の SSR は Lambda 上で動きます。ここが一番の落とし穴です。
 *
 *  - Lambda は同時実行数だけインスタンスが増えます。各インスタンスが
 *    プールを持つので、max を大きくすると RDS の接続上限を簡単に超えます。
 *    1インスタンスあたり max: 1〜2 に抑えるのが鉄則です。
 *  - モジュールスコープに置いてウォームスタート間で使い回します。
 *    リクエストごとに new Pool すると接続が枯渇します。
 *  - 本番で同時実行が増えるなら RDS Proxy を挟んでください。
 *    Lambda + RDS の組み合わせでは実質必須です。
 *  - Aurora Serverless v2 の Data API を使う手もありますが、
 *    その場合はこのファイルごと差し替えになります。
 */

const g = globalThis as unknown as { __pgPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL が未設定です");
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
      process.env.PGSSL === "disable"
        ? undefined
        : { rejectUnauthorized: false },
  });
}

export const pool: Pool = g.__pgPool ?? (g.__pgPool = createPool());

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
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
  const client = await pool.connect();
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
