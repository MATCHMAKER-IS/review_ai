-- レビューAI：受信メッセージ ＋ 判定結果
--
-- 1. API に POST された ai / sent をそのまま1行ずつ保存（review_messages）
-- 2. 同じ ticket_id で ai と sent が揃ったら OpenAI が差異を判定
-- 3. 判定結果を1行保存（review_judgments）
--
--   実行: psql "$DATABASE_URL" -f db/schema.sql
--   何度実行しても安全です（IF NOT EXISTS）。

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ════════════════════════════════════════
-- 受信メッセージ
--   ai と sent が別々に届くので、同じ ticket_id で2レコードできます。
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS review_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- レコードID

  ticket_id       TEXT NOT NULL,                 -- 問い合わせID
  message         TEXT NOT NULL,                 -- メッセージ内容
  type            TEXT NOT NULL                  -- ai / sent
                  CHECK (type IN ('ai', 'sent')),
  staff_id        TEXT,                          -- 担当ユーザーのID（移行期。将来削除予定）
  staff_name      TEXT,                          -- 担当ユーザーの氏名
  memory_version  INTEGER,                       -- メモリのバージョン番号

  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 受信日時
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()   -- DB更新日時
);

CREATE INDEX IF NOT EXISTS idx_review_messages_ticket
  ON review_messages (ticket_id, type, received_at);

CREATE INDEX IF NOT EXISTS idx_review_messages_staff
  ON review_messages (staff_id, received_at DESC);

-- ════════════════════════════════════════
-- 判定結果
--   ai と sent が揃ったときに1行作られます。
--   ticket_id ごとに1件（UNIQUE）。再判定時は上書きします。
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS review_judgments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- レコードID

  ticket_id       TEXT NOT NULL UNIQUE,          -- 問い合わせID（1チケット1判定）
  staff_id        TEXT,                          -- 担当ユーザーのID（移行期。将来削除予定）
  staff_name      TEXT,                          -- 担当ユーザーの氏名
  memory_version  INTEGER,                       -- ai を生成したメモリの版数

  -- 突き合わせた元の文面（後から追跡できるよう控えを持つ）
  ai_message      TEXT NOT NULL,
  sent_message    TEXT NOT NULL,

  -- ── 機械的に決まる部分（OpenAI不要）──────
  has_diff        BOOLEAN NOT NULL,              -- 差異があるか
  diff_ratio      NUMERIC(5,3) NOT NULL,         -- 修正量（0〜1）

  -- ── §7 の切り分け ──────────────────────
  -- judgment = 判断AIのミス / generation = 生成AIのミス
  -- none = 修正なし / unknown = 判断保留
  fault           TEXT NOT NULL
                  CHECK (fault IN ('judgment','generation','none','unknown')),
  fault_reason    TEXT,

  -- ── OpenAI が言語化した部分 ──────────────
  diff_summary    TEXT,                          -- 差異の要約（一文）

  -- 差分箇所の抽出。複数箇所あっても、すべてここに入ります。
  --   diffs      : [{before, after, kind}, ...] を構造のまま保持。
  --                これが正。1件ずつ正確に対応を取りたいときは
  --                jsonb_array_elements(diffs) で展開する。
  --   diff_count : 差分の個数（0件＝修正なし）
  --   diff_pairs : 「① before → after」形式で全件を並べた目視用テキスト。
  --                before/after を別列にすると複数件で行ずれするため、
  --                ペアを1行に結んで持つ。
  diffs           JSONB,
  diff_count      INTEGER NOT NULL DEFAULT 0,
  diff_pairs      TEXT,

  analysis        JSONB,
  openai_raw      JSONB,                         -- OpenAIから受信したレスポンス全文（監査・再現用）

  -- ── 実行時の版情報（再現・比較用）────────
  model           TEXT,                          -- 実際に動いたモデル
  review_prompt_version TEXT,                     -- レビュープロンプトの版
  openai_response_id    TEXT,                     -- OpenAI のレスポンスID
  openai_error    TEXT,                          -- OpenAI 呼び出しが失敗した場合の理由

  judged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 判定日時
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()   -- DB更新日時
);

CREATE INDEX IF NOT EXISTS idx_review_judgments_staff
  ON review_judgments (staff_id, judged_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_judgments_fault
  ON review_judgments (staff_id, fault, judged_at DESC);

-- ── updated_at を自動更新するトリガー ──────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_messages_updated_at ON review_messages;
CREATE TRIGGER trg_review_messages_updated_at
  BEFORE UPDATE ON review_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_review_judgments_updated_at ON review_judgments;
CREATE TRIGGER trg_review_judgments_updated_at
  BEFORE UPDATE ON review_judgments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ════════════════════════════════════════
-- コメント（人が判定結果に残すメモ）
--   1つの判定(ticket_id)に複数のコメントを時系列で残せます。
--   誰が書いたかの author は任意。画面から入力します。
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS review_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   TEXT NOT NULL,               -- どの判定へのコメントか
  author      TEXT,                        -- 記入者（任意）
  body        TEXT NOT NULL,               -- コメント本文
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_comments_ticket
  ON review_comments (ticket_id, created_at);

-- ── 参考ビュー：メッセージと判定を横並びで見る ──
CREATE OR REPLACE VIEW review_overview AS
SELECT
  j.ticket_id,
  j.staff_id,
  j.memory_version,
  j.has_diff,
  j.diff_ratio,
  j.fault,
  j.diff_summary,
  j.model,
  j.judged_at
FROM review_judgments j
ORDER BY j.judged_at DESC;
