-- 遊栄 SNS素材・投稿管理 初期スキーマ（PostgreSQL / Supabase / PGlite 共通）
-- 店舗をまたぐ関連付けは「(id, store_id)」への複合外部キーでDB側でも禁止する。

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL,
  password_hash text NOT NULL,
  is_system_admin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  sort_order int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_store_memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id),
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);

CREATE TABLE casts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  furigana text,
  sort_order int,
  memo text,
  photo_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (id, store_id)
);
CREATE INDEX casts_store_idx ON casts(store_id);

CREATE TABLE question_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  set_number int NOT NULL,
  version int NOT NULL DEFAULT 1,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_number, version)
);

CREATE TABLE questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  question_set_id uuid NOT NULL REFERENCES question_sets(id),
  position int NOT NULL CHECK (position BETWEEN 1 AND 3),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_set_id, position)
);

-- 素材番号の採番（店舗×種別ごと）。ON CONFLICT DO UPDATE で同時登録でも重複しない。
CREATE TABLE counters (
  store_id uuid NOT NULL REFERENCES stores(id),
  scope text NOT NULL,
  value int NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, scope)
);

CREATE TABLE material_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  category text NOT NULL CHECK (category IN
    ('interview','self_pr_image','self_pr_video','brand_video','daily_photo','event_material','other')),
  other_label text,
  media_kind text NOT NULL CHECK (media_kind IN ('image','video','other')),
  display_code text NOT NULL,
  seq int NOT NULL,
  title text NOT NULL,
  shot_on date NOT NULL,
  status text NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','editing','ready','unusable')),
  storage_url text,
  memo text,
  request_key text UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  UNIQUE (id, store_id),
  UNIQUE (store_id, display_code)
);
CREATE INDEX material_batches_store_idx ON material_batches(store_id, shot_on);

CREATE TABLE interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  batch_id uuid,
  question_set_id uuid NOT NULL REFERENCES question_sets(id),
  shot_on date NOT NULL,
  take_no int NOT NULL CHECK (take_no >= 1),
  memo text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  UNIQUE (id, store_id),
  FOREIGN KEY (batch_id, store_id) REFERENCES material_batches(id, store_id)
);
CREATE INDEX interview_sessions_store_idx ON interview_sessions(store_id, shot_on);

CREATE TABLE material_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id),
  seq int NOT NULL,
  code text NOT NULL,
  media_kind text NOT NULL CHECK (media_kind IN ('image','video','other')),
  status text NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','editing','ready','unusable')),
  memo text,
  storage_url text,
  derived_from_item_id uuid REFERENCES material_items(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  UNIQUE (id, store_id),
  UNIQUE (store_id, code),
  UNIQUE (batch_id, seq),
  FOREIGN KEY (batch_id, store_id) REFERENCES material_batches(id, store_id)
);
CREATE INDEX material_items_batch_idx ON material_items(batch_id);

CREATE TABLE material_item_casts (
  item_id uuid NOT NULL,
  cast_id uuid NOT NULL,
  store_id uuid NOT NULL,
  PRIMARY KEY (item_id, cast_id),
  FOREIGN KEY (item_id, store_id) REFERENCES material_items(id, store_id),
  FOREIGN KEY (cast_id, store_id) REFERENCES casts(id, store_id)
);
CREATE INDEX material_item_casts_cast_idx ON material_item_casts(cast_id);

CREATE TABLE interview_participants (
  session_id uuid NOT NULL,
  cast_id uuid NOT NULL,
  store_id uuid NOT NULL,
  PRIMARY KEY (session_id, cast_id),
  FOREIGN KEY (session_id, store_id) REFERENCES interview_sessions(id, store_id),
  FOREIGN KEY (cast_id, store_id) REFERENCES casts(id, store_id)
);

CREATE TABLE answer_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  session_id uuid NOT NULL,
  cast_id uuid NOT NULL,
  question_id uuid NOT NULL REFERENCES questions(id),
  question_text_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'unanswered' CHECK (status IN ('unanswered','answered','passed')),
  answered_on date,
  material_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  UNIQUE (session_id, cast_id, question_id),
  CHECK (status <> 'answered' OR answered_on IS NOT NULL),
  FOREIGN KEY (session_id, cast_id) REFERENCES interview_participants(session_id, cast_id),
  FOREIGN KEY (material_item_id, store_id) REFERENCES material_items(id, store_id)
);
CREATE INDEX answer_records_cast_idx ON answer_records(cast_id, question_id);

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  post_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('interview','self_pr','brand_video','daily_photo','other')),
  other_label text,
  question_set_id uuid REFERENCES question_sets(id),
  title text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('instagram','tiktok','other')),
  format text,
  status text NOT NULL CHECK (status IN ('draft','scheduled','published','cancelled')),
  scheduled_at timestamptz,
  published_at timestamptz,
  original_scheduled_at timestamptz,
  url text,
  caption text,
  memo text,
  public_state_note text,
  request_key text UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  UNIQUE (id, store_id),
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX posts_store_idx ON posts(store_id, status);

CREATE TABLE post_materials (
  post_id uuid NOT NULL,
  item_id uuid NOT NULL,
  store_id uuid NOT NULL,
  PRIMARY KEY (post_id, item_id),
  FOREIGN KEY (post_id, store_id) REFERENCES posts(id, store_id),
  FOREIGN KEY (item_id, store_id) REFERENCES material_items(id, store_id)
);
CREATE INDEX post_materials_item_idx ON post_materials(item_id);

CREATE TABLE post_casts (
  post_id uuid NOT NULL,
  cast_id uuid NOT NULL,
  store_id uuid NOT NULL,
  PRIMARY KEY (post_id, cast_id),
  FOREIGN KEY (post_id, store_id) REFERENCES posts(id, store_id),
  FOREIGN KEY (cast_id, store_id) REFERENCES casts(id, store_id)
);
CREATE INDEX post_casts_cast_idx ON post_casts(cast_id);

-- Supabase等でPostgREST経由の直接アクセスを遮断するため、全テーブルでRLSを有効化する。
-- ポリシーは作らない（= anon/authenticated ロールは全拒否）。アプリはサーバー側の
-- DB接続（テーブル所有者/サービスロール）だけで読み書きし、店舗権限はサーバーで検証する。
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_store_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE casts ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_item_casts ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_casts ENABLE ROW LEVEL SECURITY;
