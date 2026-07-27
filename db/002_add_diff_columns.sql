-- 002: 差分箇所の抽出列を追加
--
-- 既に review_judgments テーブルを作成済みの場合に、
-- テーブルを作り直さず列だけ足すためのマイグレーションです。
--
--   実行: psql "$DATABASE_URL" -f db/002_add_diff_columns.sql
--   何度実行しても安全です（IF NOT EXISTS）。
--
-- 複数箇所の変更に対応します。
--   diffs      : [{before, after, kind}, ...] を構造のまま保持（これが正）
--   diff_count : 差分の個数
--   diff_pairs : 「① before → after」形式の目視用テキスト

ALTER TABLE review_judgments
  ADD COLUMN IF NOT EXISTS diffs      JSONB,
  ADD COLUMN IF NOT EXISTS diff_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS diff_pairs TEXT;

-- 以前のバージョンで diff_before / diff_after を作っていた場合は削除。
-- （行ずれのリスクがあるため diff_pairs に一本化しました）
ALTER TABLE review_judgments DROP COLUMN IF EXISTS diff_before;
ALTER TABLE review_judgments DROP COLUMN IF EXISTS diff_after;
