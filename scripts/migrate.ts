import { createDb, migrate, seedMaster } from '../src/lib/db';

const db = await createDb();
const applied = await migrate(db);
await seedMaster(db);
console.log(applied.length ? `適用したマイグレーション: ${applied.join(', ')}` : 'マイグレーションは最新です。');
console.log('初期マスター（3店舗・20セット60問）を投入しました（再実行しても重複しません）。');
await db.close();
