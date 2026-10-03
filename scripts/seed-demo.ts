// デモ/動作確認専用。架空のキャスト・素材・投稿を作ります。本番DBでは実行しないでください。
import { createDb, migrate, seedMaster } from '../src/lib/db';
import { createUser } from '../src/lib/auth';
import { createCast } from '../src/lib/domain/casts';
import { createMaterial } from '../src/lib/domain/materials';
import { createPosts } from '../src/lib/domain/posts';

if (process.env.DATABASE_URL && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('DATABASE_URL が設定されています。デモデータは本番の実績と混ざるため中止しました（本当に実行するなら ALLOW_DEMO_SEED=true）。');
  process.exit(1);
}
const db = await createDb();
await migrate(db);
await seedMaster(db);
const admin = { userId: (await db.query<{ id: string }>("SELECT id FROM users WHERE email='demo-admin@example.com'"))[0]?.id ?? await createUser(db, { email: 'demo-admin@example.com', displayName: 'デモ管理者', password: 'demo-password-123', isSystemAdmin: true }), isSystemAdmin: true };
const store = (await db.query<{ id: string }>("SELECT id FROM stores WHERE key='b-club'"))[0].id;
const a = await createCast(db, admin, store, { displayName: '【デモ】Aさん' });
const m = await createMaterial(db, admin, store, { category: 'self_pr_image', mediaKind: 'image', quantity: 10, castIds: [a.id], shotOn: '2026-09-01', title: '【デモ】PR画像', status: 'ready' });
const items = await db.query<{ id: string }>('SELECT id FROM material_items WHERE batch_id=$1 ORDER BY seq LIMIT 3', [m.batchId]);
await createPosts(db, admin, store, { category: 'self_pr', title: '【デモ】PR投稿', itemIds: items.map((i) => i.id), castIds: [a.id], targets: [{ platform: 'instagram', status: 'published', publishedAt: '2026-09-10T19:30' }] });
console.log('デモデータを作成しました（B-club）。ログイン: demo-admin@example.com / demo-password-123');
await db.close();
