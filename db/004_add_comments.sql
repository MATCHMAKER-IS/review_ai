-- 004: コメント（メモ）テーブルを追加
--
-- 判定結果を見た人が、時系列でコメントを残せるようにします。
--   実行: psql "$DATABASE_URL" -f db/004_add_comments.sql
--   何度実行しても安全です。

CREATE TABLE IF NOT EXISTS review_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   TEXT NOT NULL,
  author      TEXT,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_comments_ticket
  ON review_comments (ticket_id, created_at);
