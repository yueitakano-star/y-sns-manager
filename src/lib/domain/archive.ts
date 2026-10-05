import { z } from 'zod';
import type { Db, Queryable } from '../db';
import type { Actor } from '../access';
import { requireRole } from '../access';
import { notFound, validation } from '../errors';
import { jstToday } from '../jst';
import { dateStr, idStr, optStr, parseInput, reqStr, unique } from './util';

const linkUrl = z
  .string({ error: 'リンク(URL)を入力してください。' })
  .trim()
  .min(1, 'リンク(URL)を入力してください。')
  .max(2000, 'リンクは2000文字以内にしてください。')
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'リンクは http:// または https:// で始まるURLを入力してください。');

const schema = z.object({
  requestKey: z.string().min(8).max(100).nullish(),
  title: reqStr('タイトル', 120),
  url: linkUrl,
  description: optStr('メモ', 2000),
  shotOn: dateStr('撮影・作成日').nullish().transform((v) => v || null),
  purpose: z.enum(['sns', 'ad', 'other']).nullish().transform((v) => v ?? null),
  castIds: z.array(idStr('キャスト')).max(50).default([]),
});

export interface ArchiveRow {
  id: string;
  title: string;
  url: string;
  description: string | null;
  shot_on: string | null;
  purpose: 'sns' | 'ad' | 'other' | null;
  created_at: string;
  cast_ids: string[];
  cast_names: string[];
}

const SELECT = `
  l.id, l.title, l.url, l.description, l.shot_on::text AS shot_on, l.purpose, l.created_at,
  coalesce((SELECT array_agg(c.id ORDER BY c.display_name) FROM archive_link_casts lc JOIN casts c ON c.id=lc.cast_id WHERE lc.link_id=l.id), ARRAY[]::uuid[]) AS cast_ids,
  coalesce((SELECT array_agg(c.display_name ORDER BY c.display_name) FROM archive_link_casts lc JOIN casts c ON c.id=lc.cast_id WHERE lc.link_id=l.id), ARRAY[]::text[]) AS cast_names`;

async function assertCasts(q: Queryable, storeId: string, castIds: string[]) {
  if (!castIds.length) return;
  const r = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM casts WHERE store_id=$1 AND deleted_at IS NULL AND id = ANY($2::uuid[])', [storeId, castIds]);
  if (r[0].n !== castIds.length) throw validation('この店舗に登録されていないキャストが含まれています。', { castIds: 'キャストの選択を確認してください。' });
}

export async function createArchiveLink(db: Db, actor: Actor, storeId: string, input: unknown): Promise<{ id: string; duplicate: boolean }> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(schema, input);
  if (v.shotOn && v.shotOn > jstToday()) throw validation('撮影・作成日に未来の日付は指定できません。', { shotOn: '未来の日付は指定できません。' });
  const castIds = unique(v.castIds);
  return db.tx(async (q) => {
    if (v.requestKey) {
      const ex = await q.query<{ id: string; store_id: string }>('SELECT id, store_id FROM archive_links WHERE request_key=$1', [v.requestKey]);
      if (ex[0]) {
        if (ex[0].store_id !== storeId) throw validation('不正なリクエストです。');
        return { id: ex[0].id, duplicate: true };
      }
    }
    await assertCasts(q, storeId, castIds);
    const r = await q.query<{ id: string }>(
      `INSERT INTO archive_links(store_id, title, url, description, shot_on, purpose, request_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [storeId, v.title, v.url, v.description, v.shotOn, v.purpose, v.requestKey ?? null, actor.userId],
    );
    for (const c of castIds) await q.query('INSERT INTO archive_link_casts(link_id, cast_id, store_id) VALUES ($1,$2,$3)', [r[0].id, c, storeId]);
    return { id: r[0].id, duplicate: false };
  });
}

export async function updateArchiveLink(db: Db, actor: Actor, storeId: string, linkId: string, input: unknown): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('リンク'), linkId);
  const v = parseInput(schema, input);
  if (v.shotOn && v.shotOn > jstToday()) throw validation('撮影・作成日に未来の日付は指定できません。', { shotOn: '未来の日付は指定できません。' });
  const castIds = unique(v.castIds);
  await db.tx(async (q) => {
    await assertCasts(q, storeId, castIds);
    const r = await q.query(
      `UPDATE archive_links SET title=$3, url=$4, description=$5, shot_on=$6, purpose=$7, updated_at=now()
        WHERE id=$1 AND store_id=$2 AND voided_at IS NULL RETURNING id`,
      [linkId, storeId, v.title, v.url, v.description, v.shotOn, v.purpose],
    );
    if (!r[0]) throw notFound('リンク');
    await q.query('DELETE FROM archive_link_casts WHERE link_id=$1', [linkId]);
    for (const c of castIds) await q.query('INSERT INTO archive_link_casts(link_id, cast_id, store_id) VALUES ($1,$2,$3)', [linkId, c, storeId]);
  });
}

/** 誤登録・不要になったリンクを一覧から外す（論理削除。Drive側のファイルには何もしない） */
export async function voidArchiveLink(db: Db, actor: Actor, storeId: string, linkId: string, reason: unknown): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('リンク'), linkId);
  const why = parseInput(reqStr('理由', 200), reason);
  const r = await db.query('UPDATE archive_links SET voided_at=now(), void_reason=$3, updated_at=now() WHERE id=$1 AND store_id=$2 AND voided_at IS NULL RETURNING id', [linkId, storeId, why]);
  if (!r[0]) throw notFound('リンク');
}

export interface ArchiveFilter {
  castId?: string;
  common?: boolean;
  purpose?: string;
  q?: string;
}

export async function listArchiveLinks(q: Queryable, actor: Actor, storeId: string, f: ArchiveFilter = {}): Promise<ArchiveRow[]> {
  await requireRole(q, actor, storeId, 'viewer');
  const params: unknown[] = [storeId];
  const where = ['l.store_id=$1', 'l.voided_at IS NULL'];
  if (f.castId && /^[0-9a-f-]{36}$/i.test(f.castId)) {
    params.push(f.castId);
    where.push(`EXISTS (SELECT 1 FROM archive_link_casts lc WHERE lc.link_id=l.id AND lc.cast_id=$${params.length})`);
  }
  if (f.common) where.push('NOT EXISTS (SELECT 1 FROM archive_link_casts lc WHERE lc.link_id=l.id)');
  if (f.purpose && ['sns', 'ad', 'other'].includes(f.purpose)) {
    params.push(f.purpose);
    where.push(`l.purpose=$${params.length}`);
  }
  if (f.q?.trim()) {
    params.push(`%${f.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length})`);
  }
  return q.query<ArchiveRow>(`SELECT ${SELECT} FROM archive_links l WHERE ${where.join(' AND ')} ORDER BY coalesce(l.shot_on, l.created_at::date) DESC, l.created_at DESC`, params);
}

export async function getArchiveLink(q: Queryable, actor: Actor, storeId: string, linkId: string): Promise<ArchiveRow> {
  await requireRole(q, actor, storeId, 'viewer');
  if (!/^[0-9a-f-]{36}$/i.test(linkId)) throw notFound('リンク');
  const r = await q.query<ArchiveRow>(`SELECT ${SELECT} FROM archive_links l WHERE l.id=$1 AND l.store_id=$2 AND l.voided_at IS NULL`, [linkId, storeId]);
  if (!r[0]) throw notFound('リンク');
  return r[0];
}

/** 表示用: Googleドライブ/ドキュメント系のURLか */
export function isDriveUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'drive.google.com' || h === 'docs.google.com' || h.endsWith('.googleusercontent.com');
  } catch {
    return false;
  }
}
