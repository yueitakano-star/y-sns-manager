-- 担当者は「名前 + PIN」でもログインできるようにする（メールは任意）。連続失敗でアカウントを一時ロック。
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN login_name text;
ALTER TABLE users ADD COLUMN failed_count int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until timestamptz;
ALTER TABLE users ADD CONSTRAINT users_login_name_chk CHECK (login_name IS NULL OR (length(btrim(login_name)) > 0 AND position('@' in login_name) = 0));
ALTER TABLE users ADD CONSTRAINT users_identity_chk CHECK (email IS NOT NULL OR login_name IS NOT NULL);
CREATE UNIQUE INDEX users_login_name_uniq ON users(login_name) WHERE login_name IS NOT NULL;
