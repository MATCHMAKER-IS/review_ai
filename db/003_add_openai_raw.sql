-- 003: OpenAI の生レスポンス全文を保存する列を追加
--
-- 既に review_judgments を作成済みの場合に、列だけ足すマイグレーションです。
--   openai_raw : OpenAI API から受信したレスポンス全体（JSONB）
--                monitoring・再現・後からの再解析のために丸ごと残します。
--
--   実行: psql "$DATABASE_URL" -f db/003_add_openai_raw.sql
--   何度実行しても安全です。

ALTER TABLE review_judgments
  ADD COLUMN IF NOT EXISTS openai_raw JSONB;
