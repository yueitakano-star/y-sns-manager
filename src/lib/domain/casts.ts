import { z } from 'zod';
import type { Db, Queryable } from '../db';
import type { Actor } from '../access';
import { requireRole } from '../access';
import { notFound } from '../errors';
import { idStr, optStr, parseInput, reqStr, urlOpt } from './util';

const castSchema = z.object({
  displayName: reqStr('表示名', 60),
  furigana: optStr('ふりがな', 60),
  sortOrder: z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v) => (v === '' || v == null ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 100000), '並び順は0以上の整数で入力してください。'),
  memo: optStr('メモ', 1000),
  photoUrl: urlOpt('写真URL'),
  status: z.enum(['active', 'inactive'], { error: '在籍状態を選択してください。' }).default('active'),
});

export interface CastRow {
  id: string;
  store_id: string;
  display_name: string;
  furigana: string | null;
  sort_order: number | null;
  memo: string | null;
  photo_url: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

const COLS = 'id, store_id, display_name, furigana, sort_order, memo, photo_url, status, created_at, updated_at';

export async function createCast(db: Db, actor: Actor, storeId: string, input: unknown): Promise<CastRow> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(castSchema, input);
  const rows = await db.query<CastRow>(
    `INSERT INTO casts(store_id, display_name, furigana, sort_order, memo, photo_url, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLS}`,
    [storeId, v.displayName, v.furigana, v.sortOrder, v.memo, v.photoUrl, v.status, actor.userId],
  );
  return rows[0];
}

export async function updateCast(db: Db, actor: Actor, storeId: string, castId: string, input: unknown): Promise<CastRow> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('キャスト'), castId);
  const v = parseInput(castSchema, input);
  const rows = await db.query<CastRow>(
    `UPDATE casts SET display_name=$3, furigana=$4, sort_order=$5, memo=$6, photo_url=$7, status=$8, updated_at=now()
      WHERE id=$1 AND store_id=$2 AND deleted_at IS NULL RETURNING ${COLS}`,
    [castId, storeId, v.displayName, v.furigana, v.sortOrder, v.memo, v.photoUrl, v.status],
  );
  if (!rows[0]) throw notFound('キャスト');
  return rows[0];
}

export async function getCast(q: Queryable, actor: Actor, storeId: string, castId: string): Promise<CastRow> {
  await requireRole(q, actor, storeId, 'viewer');
  if (!/^[0-9a-f-]{36}$/i.test(castId)) throw notFound('キャスト');
  const rows = await q.query<CastRow>(`SELECT ${COLS} FROM casts WHERE id=$1 AND store_id=$2 AND deleted_at IS NULL`, [
    castId,
    storeId,
  ]);
  if (!rows[0]) throw notFound('キャスト');
  return rows[0];
}

export async function listCasts(q: Queryable, actor: Actor, storeId: string, opts: { activeOnly?: boolean } = {}) {
  await requireRole(q, actor, storeId, 'viewer');
  return q.query<CastRow>(
    `SELECT ${COLS} FROM casts WHERE store_id=$1 AND deleted_at IS NULL ${opts.activeOnly ? "AND status='active'" : ''}
      ORDER BY (status='active') DESC, sort_order NULLS LAST, furigana NULLS LAST, display_name`,
    [storeId],
  );
}
