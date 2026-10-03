import 'server-only';
import { getDb } from './db';
import { requireStore } from './session';
import { canEdit } from './access';

export async function pageCtx(params: Promise<{ store: string }>) {
  const { store: key } = await params;
  const c = await requireStore(key);
  const db = await getDb();
  return { ...c, db, base: `/s/${c.store.key}`, editable: canEdit(c.role) };
}

export type SP = Record<string, string | string[] | undefined>;

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
export function many(v: string | string[] | undefined): string[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}
