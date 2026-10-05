-- 過去素材置き場: Googleドライブ等のリンク台帳。素材の在庫・使用数の集計には含めない
CREATE TABLE archive_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  url text NOT NULL,
  description text,
  shot_on date,
  purpose text CHECK (purpose IN ('sns', 'ad', 'other')),
  request_key text UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text,
  UNIQUE (id, store_id)
);
CREATE INDEX archive_links_store_idx ON archive_links(store_id, created_at DESC);

CREATE TABLE archive_link_casts (
  link_id uuid NOT NULL,
  cast_id uuid NOT NULL,
  store_id uuid NOT NULL,
  PRIMARY KEY (link_id, cast_id),
  FOREIGN KEY (link_id, store_id) REFERENCES archive_links(id, store_id),
  FOREIGN KEY (cast_id, store_id) REFERENCES casts(id, store_id)
);
CREATE INDEX archive_link_casts_cast_idx ON archive_link_casts(cast_id);

ALTER TABLE archive_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE archive_link_casts ENABLE ROW LEVEL SECURITY;
