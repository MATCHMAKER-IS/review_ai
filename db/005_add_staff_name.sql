-- 005: 担当者の氏名 staff_name を追加
--
-- staff_id（ID）は移行期のため当面残します。
-- POST してくる側が staff_name を送るようになったら、
-- 後日 staff_id を削除する予定です（その際は別マイグレーションで）。
--
--   実行: psql "$DATABASE_URL" -f db/005_add_staff_name.sql
--   何度実行しても安全です。

ALTER TABLE review_messages  ADD COLUMN IF NOT EXISTS staff_name TEXT;
ALTER TABLE review_judgments ADD COLUMN IF NOT EXISTS staff_name TEXT;
