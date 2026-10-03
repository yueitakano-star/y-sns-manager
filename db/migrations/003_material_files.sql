-- 個別素材に紐付くアップロード済みファイルの記録（実体は非公開ストレージ。ここにはパスだけ保存）
CREATE TABLE material_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  item_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  FOREIGN KEY (item_id, store_id) REFERENCES material_items(id, store_id)
);
CREATE INDEX material_files_item_idx ON material_files(item_id);
ALTER TABLE material_files ENABLE ROW LEVEL SECURITY;
