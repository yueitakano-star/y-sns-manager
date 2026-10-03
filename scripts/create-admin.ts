// 使い方: npm run create-admin -- you@example.com "表示名"   （パスワードは環境変数 ADMIN_PASSWORD で渡す）
import { createDb, migrate, seedMaster } from '../src/lib/db';
import { createUser } from '../src/lib/auth';

const [email, displayName = '管理者'] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error('使い方: ADMIN_PASSWORD=十文字以上のパスワード npm run create-admin -- メールアドレス "表示名"');
  process.exit(1);
}
const db = await createDb();
await migrate(db);
await seedMaster(db);
const id = await createUser(db, { email, displayName, password, isSystemAdmin: true });
console.log(`システム管理者を作成しました: ${email} (${id})`);
await db.close();
