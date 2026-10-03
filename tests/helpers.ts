import { createDb, migrate, seedMaster, type Db } from '../src/lib/db';
import { createUser } from '../src/lib/auth';
import type { Actor } from '../src/lib/access';

export interface Env {
  db: Db;
  stores: Record<string, string>; // key -> id
  admin: Actor;
  editorB: Actor; // B-clubのみ編集
  viewerB: Actor; // B-clubのみ閲覧
  outsider: Actor; // どの店舗にも権限なし
  editorK: Actor; // KINGYOのみ編集
}

export async function setupEnv(): Promise<Env> {
  const db = await createDb({ pgliteDir: 'memory://test' });
  await migrate(db);
  await seedMaster(db);
  const stores = Object.fromEntries(
    (await db.query<{ key: string; id: string }>('SELECT key, id FROM stores')).map((s) => [s.key, s.id]),
  );
  const mk = async (email: string, memberships: { storeId: string; role: 'admin' | 'editor' | 'viewer' }[], sys = false): Promise<Actor> => {
    const userId = await createUser(db, { email, displayName: email, password: 'password-1234', isSystemAdmin: sys, memberships });
    return { userId, isSystemAdmin: sys };
  };
  return {
    db,
    stores,
    admin: await mk('admin@example.com', [], true),
    editorB: await mk('editor-b@example.com', [{ storeId: stores['b-club'], role: 'editor' }]),
    viewerB: await mk('viewer-b@example.com', [{ storeId: stores['b-club'], role: 'viewer' }]),
    outsider: await mk('outsider@example.com', []),
    editorK: await mk('editor-k@example.com', [{ storeId: stores['kingyo'], role: 'editor' }]),
  };
}

/** 業務データだけ空にする（店舗・質問・ユーザーは残す） */
export async function resetData(db: Db): Promise<void> {
  await db.exec('TRUNCATE casts, material_batches, posts, interview_sessions, counters CASCADE');
}
