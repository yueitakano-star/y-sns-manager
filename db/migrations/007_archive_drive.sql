-- ドライブのフォルダから取り込んだ過去素材: 取り込み元の識別子(重複取り込み防止)とファイル種別
ALTER TABLE archive_links ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'drive'));
ALTER TABLE archive_links ADD COLUMN external_id text;
ALTER TABLE archive_links ADD COLUMN mime_type text;
CREATE UNIQUE INDEX archive_links_external_uniq ON archive_links(store_id, external_id)
  WHERE external_id IS NOT NULL AND voided_at IS NULL;
