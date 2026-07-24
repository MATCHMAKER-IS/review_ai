-- 002: messages テーブル
--
-- ①AIの下書きと②実際に送信した文面が、別々のタイミングで
-- 別々のワークフローから届く前提に変更したための追加です。
--
-- 実行: psql "$DATABASE_URL" -f db/002_messages.sql
-- 何度実行しても安全です。

CREATE TABLE IF NOT EXISTS messages (
  message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ticket_id       TEXT NOT NULL,
  -- ai   = AIが生成した下書き
  -- sent = コーディネーターが実際に送信した文面
  kind            TEXT NOT NULL CHECK (kind IN ('ai','sent')),
  body            TEXT NOT NULL,

  -- メモリはスタッフ個別に育てるため（§3-5）、本来は必須です。
  -- 送られてこない場合は 'unknown' で保存し、警告を返します。
  staff_id        TEXT NOT NULL DEFAULT 'unknown',

  -- kind = 'ai' のときに記録。どの版が生成した下書きかを残す
  prompt_id       TEXT,
  prompt_version  TEXT,
  model           TEXT,

  -- ペアが成立して review が作られたら埋まる
  paired_at       TIMESTAMPTZ,
  decision_id     UUID REFERENCES runs(decision_id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ペアリングの検索用。未ペアのものだけを引くので部分インデックス
CREATE INDEX IF NOT EXISTS idx_messages_unpaired
  ON messages (ticket_id, kind, created_at DESC) WHERE paired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_ticket
  ON messages (ticket_id, created_at DESC);

-- 重複POST検知用（Zohoのワークフローは二重発火することがある）
CREATE INDEX IF NOT EXISTS idx_messages_dedup
  ON messages (ticket_id, kind, created_at DESC);

-- ────────────────────────────────────────
-- 未ペアのまま放置されている下書きを見るビュー
--
-- AIが下書きを作ったのに送信されなかったケースです。
-- 「破棄された下書き」は、それ自体が精度の指標になります。
-- ────────────────────────────────────────
CREATE OR REPLACE VIEW orphan_drafts AS
SELECT
  m.message_id,
  m.ticket_id,
  m.staff_id,
  m.prompt_version,
  m.created_at,
  now() - m.created_at AS age
FROM messages m
WHERE m.kind = 'ai'
  AND m.paired_at IS NULL
ORDER BY m.created_at DESC;
