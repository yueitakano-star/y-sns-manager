-- クイズ集（全店舗共通のマスター：20セット×5問）と、投稿へのクイズセット紐付け
CREATE TABLE quiz_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  set_number int NOT NULL,
  version int NOT NULL DEFAULT 1,
  title text NOT NULL,
  comment_template text NOT NULL DEFAULT '',
  memo text,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_number, version)
);
CREATE TABLE quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  quiz_set_id uuid NOT NULL REFERENCES quiz_sets(id),
  position int NOT NULL CHECK (position BETWEEN 1 AND 5),
  level text NOT NULL,
  text text NOT NULL,
  answer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_set_id, position)
);
ALTER TABLE quiz_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;

ALTER TABLE posts ADD COLUMN quiz_set_id uuid REFERENCES quiz_sets(id);
ALTER TABLE posts DROP CONSTRAINT posts_category_check;
ALTER TABLE posts ADD CONSTRAINT posts_category_check
  CHECK (category IN ('interview','self_pr','brand_video','daily_photo','other','quiz'));
