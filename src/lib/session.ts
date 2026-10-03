import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from './db';
import { getSessionUser, type SessionUser } from './auth';
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
  return getSessionUser(db, token);
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
