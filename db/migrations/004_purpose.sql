-- 素材グループの用途（SNS / 広告 / その他）。既存データは未設定(NULL)のまま
ALTER TABLE material_batches ADD COLUMN purpose text CHECK (purpose IN ('sns', 'ad', 'other'));
