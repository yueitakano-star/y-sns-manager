import type { Queryable } from './db';
import type { Role } from './constants';
import { forbidden, notFound } from './errors';

export interface Actor {
  userId: string;
  isSystemAdmin: boolean;
  /** 1リクエスト内だけ使う店舗権限のキャッシュ（currentUserが作る） */
  roleCache?: Map<string, Role | null>;
}

export interface Store {
  id: string;
  key: string;
  name: string;
  code: string;
  sort_order: number;
}

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

/** 店舗に対するユーザーの権限。権限なしは null（システム管理者は全店舗で管理者） */
export async function getStoreRole(q: Queryable, actor: Actor, storeId: string): Promise<Role | null> {
  if (actor.isSystemAdmin) return 'admin';
  if (actor.roleCache?.has(storeId)) return actor.roleCache.get(storeId) ?? null;
  const rows = await q.query<{ role: Role }>(
    'SELECT role FROM user_store_memberships WHERE user_id = $1 AND store_id = $2',
    [actor.userId, storeId],
  );
  const role = rows[0]?.role ?? null;
  actor.roleCache?.set(storeId, role);
  return role;
}

/** 店舗IDに対し最低限の権限を要求する。権限なしは「存在しない」と同じ応答にして店舗の存在を漏らさない */
export async function requireRole(q: Queryable, actor: Actor, storeId: string, min: Role): Promise<Role> {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) throw notFound('店舗');
  const role = await getStoreRole(q, actor, storeId);
  if (!role) throw notFound('店舗');
  if (RANK[role] < RANK[min]) throw forbidden();
  return role;
}

export async function listAccessibleStores(q: Queryable, actor: Actor): Promise<(Store & { role: Role })[]> {
  if (actor.isSystemAdmin) {
    const rows = await q.query<Store>('SELECT id, key, name, code, sort_order FROM stores ORDER BY sort_order');
    return rows.map((s) => ({ ...s, role: 'admin' as Role }));
  }
  return q.query<Store & { role: Role }>(
    `SELECT s.id, s.key, s.name, s.code, s.sort_order, m.role
       FROM stores s JOIN user_store_memberships m ON m.store_id = s.id AND m.user_id = $1
      ORDER BY s.sort_order`,
    [actor.userId],
  );
}

export async function getStoreForActor(
  q: Queryable,
  actor: Actor,
  storeKey: string,
): Promise<Store & { role: Role }> {
  const stores = await listAccessibleStores(q, actor);
  const s = stores.find((x) => x.key === storeKey);
  if (!s) throw notFound('店舗');
  return s;
}

export const canEdit = (role: Role) => RANK[role] >= RANK.editor;
export const isAdmin = (role: Role) => role === 'admin';
