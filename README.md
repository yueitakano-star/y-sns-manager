# 遊栄 SNS素材・投稿管理

B-club / KINGYO / C-girl の **店舗 → キャスト → 素材 → 投稿** を記録・集計する社内業務用サイトです（日本語・スマホ優先）。
SNSへの自動投稿やAPI連携は行いません（記録専用）。

- スタック: Next.js 16 / TypeScript / Tailwind CSS 4 / PostgreSQL（本番）・PGlite（ローカル組み込みDB）
- 認証: メール＋パスワード（自己登録なし。管理者が発行）。店舗ごとに 管理者／編集スタッフ／閲覧のみ
- 日付: 表示・カレンダーの日境界は Asia/Tokyo。日時は timestamptz、撮影日・回答日は date（架空の時刻は付けません）

## セットアップ（ローカル）

```bash
npm install
cp .env.example .env        # ローカルだけなら DATABASE_URL は消す/空でOK（./.data/pglite を自動作成）
ADMIN_PASSWORD='10文字以上のパスワード' npm run create-admin -- you@example.com "管理者"
npm run build && COOKIE_SECURE=false npm start     # → http://localhost:3000
# 開発: COOKIE_SECURE=false npm run dev
```

- 初回アクセス時に自動でマイグレーションと初期マスター（3店舗・20セット60問、`seed/APP_SEED.json`）が投入されます。何度実行しても重複せず、実績データは消えません（`npm run db:seed` でも可）。
- キャストは空で始まります。デモ用の架空データが必要な時だけ `npm run seed:demo`（`DATABASE_URL` 設定時は拒否）。
- ログイン後、`/admin/users`（システム管理者のみ）でスタッフを招待し、店舗ごとの権限を付与します。

## 共有DB（Supabase など）に接続する

PC・スマホで同じ記録を見るには、共有のPostgreSQLが必要です。

1. Supabase でプロジェクトを作成し、接続文字列（Database → Connection string, Session pooler 推奨）を取得
2. `.env` に `DATABASE_URL=...` と `COOKIE_SECURE=true`（https運用時）を設定
3. `npm run db:migrate`（マイグレーション＋初期マスター）→ `npm run create-admin -- ...`
4. 全テーブルは **RLS有効・ポリシーなし**（Supabaseの公開API経由の直接アクセスは全拒否）。アプリはサーバー側のDB接続だけで読み書きし、店舗権限はサーバー処理で検証します。`DATABASE_URL` は絶対にフロントエンドやGitへ出さないでください。

## デプロイ（例: Vercel）

GitHubリポジトリを接続し、環境変数 `DATABASE_URL` / `COOKIE_SECURE=true` を設定してデプロイ。初回は上記 3 のコマンドをローカルから実行（同じ `DATABASE_URL` を使う）。

## テスト

```bash
npm run typecheck
npm test            # 集計・検算例・権限・回答進捗などのドメインテスト（32件、メモリDB）
npm run build && npm run test:e2e   # 実ブラウザ(Edge)のUIテスト 23件（別DB .data/e2e を使用）
```

## バックアップ・復元

- Supabase: ダッシュボードの Backups、または `pg_dump "$DATABASE_URL" -Fc -f backup.dump` / `pg_restore -d "$DATABASE_URL" --clean backup.dump`
- ローカル(PGlite): アプリ停止後に `.data/pglite` フォルダごとコピー／戻す
- 台帳として `ダッシュボード → CSV出力`（キャスト一覧・素材一覧・投稿履歴。数式インジェクション対策済み）も使えます

## 設計メモ

- 素材グループ＋個別素材N件を1トランザクションで作成。素材番号は `BCL-PR-0001-01` 形式で、店舗×種別のカウンタ（`INSERT … ON CONFLICT DO UPDATE`）で採番するため同時登録でも重複せず、取消しても振り直しません。
- 使用済み素材 = 有効な「投稿済み」投稿に紐付く個別素材の重複なし件数。投稿済み件数 = 有効な「投稿済み」レコード数（SNSごとに1件）。手動の「投稿済み」フラグは持ちません。
- 店舗をまたぐ関連付けは複合外部キー `(id, store_id)` でDBでも禁止。保存の連打は画面側のロック＋`request_key` の一意制約で二重登録を防ぎます。
- 誤登録の取消は論理削除（集計から除外）。投稿に紐付いた個別素材は取消不可。SNS側で後から消えた投稿は「公開状態メモ」に残します。

## 未実装・制限

- 写真・動画ファイルのアップロード（Storage）は未実装。保存場所URLと枚数・本数の記録のみ（仕様上アップロードは任意）。
- 管理者向け全店集計画面（任意項目）は未実装。
- ログイン試行の制限はプロセス内のみ（複数インスタンスでは前段のWAF等も併用してください）。
