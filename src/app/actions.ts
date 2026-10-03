'use server';

import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { createUser, login, logout, setMembership, setPin } from '@/lib/auth';
import { getStoreForActor } from '@/lib/access';
import { AppError, forbidden } from '@/lib/errors';
import { SESSION_COOKIE, cookieOptions, currentUser, requireUser } from '@/lib/session';
import { createCast, updateCast } from '@/lib/domain/casts';
import {
  addItems,
  createDerivedItem,
  createInterviewShoot,
  createMaterial,
  createQuickUpload,
  markAllAnswered,
  setAnswer,
  updateBatch,
  updateItem,
  voidBatch,
  voidItems,
} from '@/lib/domain/materials';
import { createPosts, updatePost, voidPost } from '@/lib/domain/posts';
import type { Role } from '@/lib/constants';
import { supabaseStorage } from '@/lib/storage';
import { prepareUpload, registerFile, removeFile } from '@/lib/domain/files';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; message: string; fields: Record<string, string> };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, fields: e.fields };
    console.error('[action error]', e);
    return { ok: false, message: '保存に失敗しました。通信状況を確認して、もう一度お試しください。（入力内容は残っています）', fields: {} };
  }
}

/** 店舗キーから、ログイン中ユーザーの権限つきで店舗IDを解決（権限がなければ拒否） */
async function ctx(storeKey: string) {
  const user = await currentUser();
  if (!user) throw new AppError('unauthenticated', 'ログインの有効期限が切れました。再度ログインしてください。');
  const db = await getDb();
  const store = await getStoreForActor(db, user, String(storeKey));
  return { db, user, store };
}

// ---------- 認証 ----------
export async function loginAction(email: string, password: string): Promise<ActionResult> {
  return run(async () => {
    const db = await getDb();
    const { token, expires } = await login(db, String(email ?? ''), String(password ?? ''));
    (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expires));
  });
}

export async function logoutAction(): Promise<ActionResult> {
  return run(async () => {
    const c = await cookies();
    await logout(await getDb(), c.get(SESSION_COOKIE)?.value);
    c.delete(SESSION_COOKIE);
  });
}

// ---------- キャスト ----------
export async function saveCastAction(storeKey: string, castId: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    const row = castId ? await updateCast(db, user, store.id, castId, input) : await createCast(db, user, store.id, input);
    return { id: row.id };
  });
}

// ---------- 素材 ----------
export async function createMaterialAction(storeKey: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    return createMaterial(db, user, store.id, input);
  });
}

export async function createInterviewAction(storeKey: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    return createInterviewShoot(db, user, store.id, input);
  });
}

export async function updateBatchAction(storeKey: string, batchId: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    await updateBatch(db, user, store.id, batchId, input);
  });
}

export async function updateItemAction(storeKey: string, itemId: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    await updateItem(db, user, store.id, itemId, input);
  });
}

export async function addItemsAction(storeKey: string, batchId: string, count: number) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    return addItems(db, user, store.id, batchId, count);
  });
}

export async function voidItemsAction(storeKey: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    return voidItems(db, user, store.id, input);
  });
}

export async function voidBatchAction(storeKey: string, batchId: string, reason: string) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    await voidBatch(db, user, store.id, batchId, reason);
  });
}

export async function createDerivedAction(storeKey: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    return createDerivedItem(db, user, store.id, input);
  });
}

export async function setAnswerAction(storeKey: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    await setAnswer(db, user, store.id, input);
  });
}

export async function markAllAnsweredAction(storeKey: string, sessionId: string, castId: string, answeredOn: string | null) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    await markAllAnswered(db, user, store.id, { sessionId, castId, answeredOn });
  });
}

// ---------- 投稿 ----------
export async function createPostsAction(storeKey: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    return createPosts(db, user, store.id, input);
  });
}

export async function updatePostAction(storeKey: string, postId: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    await updatePost(db, user, store.id, postId, input);
  });
}

export async function voidPostAction(storeKey: string, postId: string, reason: string) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    await voidPost(db, user, store.id, postId, reason);
  });
}

// ---------- ユーザー管理（システム管理者のみ） ----------
async function requireSystemAdmin() {
  const user = await requireUser();
  if (!user.isSystemAdmin) throw forbidden('この操作はシステム管理者のみ可能です。');
  return user;
}

export async function inviteUserAction(input: {
  email?: string;
  password?: string;
  loginName?: string;
  pin?: string;
  displayName: string;
  memberships: { storeId: string; role: Role }[];
}) {
  return run(async () => {
    await requireSystemAdmin();
    const db = await getDb();
    const valid = new Set((await db.query<{ id: string }>('SELECT id FROM stores')).map((s) => s.id));
    const memberships = (input.memberships ?? []).filter((m) => valid.has(m.storeId) && ['admin', 'editor', 'viewer'].includes(m.role));
    await createUser(db, {
      email: input.email ? String(input.email) : undefined,
      password: input.password ? String(input.password) : undefined,
      loginName: input.loginName ? String(input.loginName) : undefined,
      pin: input.pin ? String(input.pin) : undefined,
      displayName: String(input.displayName ?? ''),
      memberships,
    });
  });
}

export async function setUserPinAction(userId: string, pin: string) {
  return run(async () => {
    await requireSystemAdmin();
    await setPin(await getDb(), String(userId), String(pin ?? ''));
  });
}

export async function setMembershipAction(userId: string, storeId: string, role: Role | null) {
  return run(async () => {
    await requireSystemAdmin();
    const db = await getDb();
    if (role !== null && !['admin', 'editor', 'viewer'].includes(role)) throw forbidden('権限の指定が正しくありません。');
    const ok = await db.query('SELECT 1 FROM users u, stores s WHERE u.id=$1 AND s.id=$2', [userId, storeId]);
    if (!ok.length) throw new AppError('not_found', '対象が見つかりません。');
    await setMembership(db, userId, storeId, role);
  });
}

export async function setUserActiveAction(userId: string, active: boolean) {
  return run(async () => {
    const me = await requireSystemAdmin();
    if (me.userId === userId && !active) throw new AppError('validation', '自分自身は無効化できません。');
    const db = await getDb();
    await db.query('UPDATE users SET is_active=$2, updated_at=now() WHERE id=$1', [userId, active]);
    if (!active) await db.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  });
}

// ---------- ファイルアップロード ----------
export async function prepareUploadAction(storeKey: string, itemId: string, file: { name: string; type: string; size: number }) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    return prepareUpload(db, supabaseStorage, user, store.id, itemId, file);
  });
}

export async function registerFileAction(storeKey: string, itemId: string, input: { name: string; type: string; size: number; path: string }) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    return registerFile(db, user, store.id, itemId, input);
  });
}

export async function removeFileAction(storeKey: string, fileId: string) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    await removeFile(db, supabaseStorage, user, store.id, fileId);
  });
}

export async function quickUploadAction(storeKey: string, input: unknown) {
  return run(async () => {
    const { db, user, store } = await ctx(storeKey);
    return createQuickUpload(db, user, store.id, input);
  });
}
