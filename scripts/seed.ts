import { createDb, migrate, seedMaster } from '../src/lib/db';

const db = await createDb();
await migrate(db);
await seedMaster(db);
const [s] = await db.query<{ stores: number; sets: number; questions: number }>(
  `SELECT (SELECT count(*) FROM stores)::int AS stores, (SELECT count(*) FROM question_sets)::int AS sets, (SELECT count(*) FROM questions)::int AS questions`,
);
console.log(`店舗 ${s.stores} / 質問セット ${s.sets} / 質問 ${s.questions}`);
await db.close();
