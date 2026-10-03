import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from './db';
import { randomBytes } from 'node:crypto';
import { createUser, getSessionUser, type SessionUser } from './auth';
import { getStoreForActor, listAccessibleStores, type Store } from './access';
import type { Role } from './constants';
import { AppError } from './errors';

export const SESSION_COOKIE = 'sns_session';

export const cookieOptions = (expires?: Date) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
  ...(expires ? { expires } : {}),
});

/** 1リクエスト内でキャッシュされる現在のユーザー */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const db = await getDb();
  const u = await getSessionUser(db, token);
  if (u) return u;
  // 一時的なログイン省略（ローカル組み込みDB専用）。共有DB(DATABASE_URL)では無効
  // NO_AUTH=true は共有DBでも有効（URLを知っていれば誰でも操作できるので一時利用のみ）
  if (process.env.NO_AUTH === 'true' || (process.env.DEV_NO_AUTH === 'true' && !process.env.DATABASE_URL)) {
    const email = 'local-dev@example.local';
    let rows = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (!rows[0]) {
      const id = await createUser(db, { email, displayName: 'ローカル利用者', password: randomBytes(24).toString('base64url'), isSystemAdmin: true });
      rows = [{ id }];
    }
    return { userId: rows[0].id, email, displayName: 'ローカル利用者', isSystemAdmin: true };
  }
  return null;
});

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireStore(storeKey: string): Promise<{ user: SessionUser; store: Store; role: Role }> {
  const user = await requireUser();
  const db = await getDb();
  try {
    const s = await getStoreForActor(db, user, storeKey);
    return { user, store: s, role: s.role };
  } catch (e) {
    if (e instanceof AppError && e.code === 'not_found') redirect('/?denied=1');
    throw e;
  }
}

export async function userStores(user: SessionUser) {
  return listAccessibleStores(await getDb(), user);
}
