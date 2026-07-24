-- セッティングAI ④レビュー学習
-- PostgreSQL スキーマ
--
-- 実行: psql "$DATABASE_URL" -f db/schema.sql
-- 何度実行しても安全です（IF NOT EXISTS）。

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ════════════════════════════════════════
-- runs : AIが下書きを生成した1回分
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS runs (
  decision_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ticket_id        TEXT NOT NULL,
  deal_id          TEXT,
  staff_id         TEXT NOT NULL,

  status           TEXT NOT NULL DEFAULT 'pending_review'
                   CHECK (status IN ('pending_review','escalated','reviewed','failed')),

  -- AIが作った下書き本文
  ai_body          TEXT NOT NULL,

  -- ①判断AIの出力。§6-6 の rationale はここに丸ごと入る
  decision         JSONB,
  -- ②生成AIの出力（used_memory_rules を含む）
  draft            JSONB,
  context_pack     JSONB,

  -- どのプロンプト版・どのモデルが生成したか。
  -- これが無いと「精度が落ちたのはメモリのせいか、プロンプトが
  -- 書き換わったせいか」を後から切り分けられません。
  prompt_id        TEXT,
  prompt_version   TEXT,
  model            TEXT,

  escalate_reason  TEXT,
  error            TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_ticket  ON runs (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_staff   ON runs (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_prompt  ON runs (staff_id, prompt_version);

-- ════════════════════════════════════════
-- reviews : コーディネーターが実際に送った文面との突き合わせ
--           §3-4 Review Record
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reviews (
  decision_id            UUID PRIMARY KEY
                         REFERENCES runs(decision_id) ON DELETE CASCADE,
  staff_id               TEXT NOT NULL,

  action                 TEXT NOT NULL
                         CHECK (action IN ('approve','edit','reject')),
  score                  SMALLINT CHECK (score BETWEEN 1 AND 5),
  comment                TEXT,

  ai_body                TEXT NOT NULL,
  sent_body              TEXT NOT NULL,
  -- 修正の「大きさ」。学習の要否を決める閾値ではありません（§7の指標用）
  diff_ratio             NUMERIC(5,3) NOT NULL,

  -- §7 の切り分け結果。書き込み時に確定させます。
  -- 判定はルールベースなのでLLMを介さず、ここに事実として残せます。
  fault                  TEXT NOT NULL
                         CHECK (fault IN ('judgment','generation','none','unknown')),
  fault_reason           TEXT NOT NULL,

  -- §3-4 への追加分。承認画面から来た場合のみ入る
  decision_ok            BOOLEAN,
  corrected_next_action  TEXT,
  corrected_recipient    TEXT CHECK (corrected_recipient IN ('男性','女性')),

  reviewed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ④が分析済みかどうか。同じレビューから何度もルールを作らないための印
  analyzed_at            TIMESTAMPTZ
);

-- ④のバッチ取得用。未分析のものを古い順に引く
CREATE INDEX IF NOT EXISTS idx_reviews_unanalyzed
  ON reviews (staff_id, reviewed_at) WHERE analyzed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_fault
  ON reviews (staff_id, fault, reviewed_at DESC);

-- ════════════════════════════════════════
-- memories : §3-5 スタッフ個別メモリ
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS memories (
  staff_id    TEXT PRIMARY KEY,
  version     INTEGER NOT NULL DEFAULT 0,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 監査用。いつ誰の承認で版が上がったかを残す
CREATE TABLE IF NOT EXISTS memory_versions (
  staff_id     TEXT NOT NULL,
  version      INTEGER NOT NULL,
  data         JSONB NOT NULL,
  proposal_id  UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, version)
);

-- ════════════════════════════════════════
-- proposals : ④が出すメモリ修正案
--             AIは適用しません。承認画面からのみ反映されます（§3-5 / §5）
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS proposals (
  proposal_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        TEXT NOT NULL,

  type            TEXT NOT NULL CHECK (type IN ('add','update','retire','conflict')),
  target          TEXT NOT NULL CHECK (target IN ('judgment_rules','style_rules','ng_list')),
  target_rule_id  TEXT,
  rule            JSONB,

  -- 本人が承認判断するための根拠。これが空の提案は出しません
  evidence        JSONB NOT NULL DEFAULT '[]'::jsonb,
  note            TEXT NOT NULL,

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proposals_pending
  ON proposals (staff_id, created_at DESC) WHERE status = 'pending';

-- ════════════════════════════════════════
-- rule_usage : ルールの適用実績
--
-- §3-5 の契約（メモリのJSON構造）を変えずに引退判定をするため、
-- メモリ本体ではなく別テーブルに持ちます。
-- Draft の used_memory_rules から加算します。
-- ════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rule_usage (
  staff_id      TEXT NOT NULL,
  rule_id       TEXT NOT NULL,
  hits          INTEGER NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  PRIMARY KEY (staff_id, rule_id)
);

-- ════════════════════════════════════════
-- 便利ビュー：§7 の指標をプロンプト版ごとに出す
--
-- 版を混ぜた平均は意味を持ちません。プロンプトを変えた前後で
-- 無修正承認率がどう動いたかは、この分割で初めて見えます。
-- ════════════════════════════════════════
CREATE OR REPLACE VIEW metrics_by_prompt_version AS
SELECT
  r.staff_id,
  r.prompt_id,
  r.prompt_version,
  r.model,
  COUNT(*)                                             AS reviews,
  ROUND(AVG(CASE WHEN rv.action = 'approve' THEN 1 ELSE 0 END)::numeric, 3) AS approve_rate,
  ROUND(AVG(rv.diff_ratio), 3)                         AS diff_ratio_avg,
  ROUND(AVG(CASE WHEN rv.fault = 'judgment'   THEN 1 ELSE 0 END)::numeric, 3) AS judgment_fault_rate,
  ROUND(AVG(CASE WHEN rv.fault = 'generation' THEN 1 ELSE 0 END)::numeric, 3) AS generation_fault_rate,
  MIN(rv.reviewed_at)                                  AS first_reviewed_at,
  MAX(rv.reviewed_at)                                  AS last_reviewed_at
FROM reviews rv
JOIN runs r ON r.decision_id = rv.decision_id
GROUP BY r.staff_id, r.prompt_id, r.prompt_version, r.model;
