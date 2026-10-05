import { z } from 'zod';
import type { Db, Queryable } from '../db';
import type { Actor } from '../access';
import { requireRole } from '../access';
import { AppError, validation } from '../errors';
import { FOLDER_MIME, getDriveFile, listChildren, listTree, parseDriveId, type DriveFile } from '../gdrive';
import { jstDate, jstToday } from '../jst';
import { dateStr, idStr, optStr, parseInput, reqStr, unique } from './util';

export type ImportGroup = 'files' | 'subfolders';

export interface ImportEntry {
  id: string;
  title: string;
  url: string;
  mimeType: string;
  kind: 'file' | 'folder';
  /** 例: 「2025春/アスカ」 */
  path: string;
  shotOn: string | null;
  size: number | null;
  suggestedCastIds: string[];
  alreadyImported: boolean;
}

export interface ImportPreview {
  rootName: string;
  entries: ImportEntry[];
  truncated: boolean;
}

/** ファイル名・フォルダ名に含まれるキャスト名から出演者を推定（長い名前を優先。短い名前の誤一致を避けるため2文字以上のみ） */
export function guessCasts(text: string, casts: { id: string; display_name: string }[]): string[] {
  const t = text.normalize('NFKC').toLowerCase();
  const hit: string[] = [];
  let rest = t;
  for (const c of [...casts].sort((a, b) => b.display_name.length - a.display_name.length)) {
    const n = c.display_name.normalize('NFKC').toLowerCase();
    if (n.length >= 2 && rest.includes(n)) {
      hit.push(c.id);
      rest = rest.split(n).join(' ');
    }
  }
  return hit;
}

function dateOf(f: DriveFile): string | null {
  // 撮影日(EXIF)を優先。なければドライブ上の作成日。未来日は登録できないので今日までに丸める
  const iso = f.photoTime ? new Date(`${f.photoTime}+09:00`).toISOString() : f.createdTime ?? f.modifiedTime;
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null;
  const d = f.photoTime ? f.photoTime.slice(0, 10) : jstDate(iso);
  return d > jstToday() ? jstToday() : d;
}

async function existingIds(q: Queryable, storeId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const r = await q.query<{ external_id: string }>(
    'SELECT external_id FROM archive_links WHERE store_id=$1 AND voided_at IS NULL AND external_id = ANY($2::text[])',
    [storeId, ids],
  );
  return new Set(r.map((x) => x.external_id));
}

/** 取り込み前の確認用: フォルダの中身を読み取って一覧にする（まだ何も登録しない） */
export async function previewDriveImport(
  db: Db,
  actor: Actor,
  storeId: string,
  input: { folderUrl: string; group: ImportGroup },
  fetchImpl: typeof fetch = fetch,
): Promise<ImportPreview> {
  await requireRole(db, actor, storeId, 'editor');
  const rootId = parseDriveId(String(input.folderUrl ?? ''));
  if (!rootId) throw new AppError('validation', 'GoogleドライブのフォルダのURLを入力してください。', { folderUrl: 'フォルダのURLを確認してください。' });
  const root = await getDriveFile(rootId, fetchImpl);
  if (root.mimeType !== FOLDER_MIME) throw new AppError('validation', 'フォルダのURLを入力してください（ファイルのURLではなく、フォルダを開いたときのURLです）。', { folderUrl: 'フォルダではありません。' });
  const casts = await db.query<{ id: string; display_name: string }>('SELECT id, display_name FROM casts WHERE store_id=$1 AND deleted_at IS NULL', [storeId]);

  let raw: { f: DriveFile; path: string[] }[] = [];
  let truncated = false;
  if (input.group === 'subfolders') {
    const kids = await listChildren(rootId, { max: 500 }, fetchImpl);
    raw = kids.map((f) => ({ f, path: [] }));
    truncated = kids.length >= 500;
  } else {
    const t = await listTree(rootId, { depth: 3, max: 500 }, fetchImpl);
    raw = t.files.map((f) => ({ f, path: f.path }));
    truncated = t.truncated;
  }
  const ids = raw.map((r) => r.f.id);
  const seen = await existingIds(db, storeId, ids);
  const entries: ImportEntry[] = raw.map(({ f, path }) => ({
    id: f.id,
    title: f.name,
    url: f.webViewLink,
    mimeType: f.mimeType,
    kind: f.isFolder ? 'folder' : 'file',
    path: [root.name, ...path].join(' / '),
    shotOn: dateOf(f),
    size: f.size,
    suggestedCastIds: guessCasts(`${[root.name, ...path].join(' ')} ${f.name}`, casts),
    alreadyImported: seen.has(f.id),
  }));
  return { rootName: root.name, entries, truncated };
}

const itemSchema = z.object({
  externalId: z.string().regex(/^[A-Za-z0-9_-]{10,}$/, 'ドライブのIDが正しくありません。'),
  title: reqStr('タイトル', 200),
  url: z.string().url().max(2000),
  mimeType: z.string().max(200).nullish().transform((v) => v || null),
  shotOn: dateStr('撮影・作成日').nullish().transform((v) => v || null),
  castIds: z.array(idStr('キャスト')).max(20).default([]),
  purpose: z.enum(['sns', 'ad', 'other']).nullish().transform((v) => v ?? null),
  description: optStr('メモ', 2000),
});
const importSchema = z.object({ items: z.array(itemSchema).min(1, '取り込むものを選んでください。').max(500, '一度に取り込めるのは500件までです。') });

/** 確認済みの一覧を過去素材置き場に登録する。同じドライブのファイル/フォルダは二重に登録しない */
export async function importDriveItems(db: Db, actor: Actor, storeId: string, input: unknown): Promise<{ imported: number; skipped: number }> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(importSchema, input);
  for (const it of v.items) {
    let host = '';
    try {
      host = new URL(it.url).hostname;
    } catch {
      /* urlの検証はzodで済み */
    }
    if (!['drive.google.com', 'docs.google.com'].includes(host) || !it.url.includes(it.externalId)) {
      throw validation('Googleドライブ以外、またはIDと一致しないリンクが含まれています。');
    }
    if (it.shotOn && it.shotOn > jstToday()) throw validation('撮影・作成日に未来の日付は指定できません。');
  }
  const allCasts = unique(v.items.flatMap((i) => i.castIds));
  return db.tx(async (q) => {
    if (allCasts.length) {
      const r = await q.query<{ n: number }>('SELECT count(*)::int AS n FROM casts WHERE store_id=$1 AND deleted_at IS NULL AND id = ANY($2::uuid[])', [storeId, allCasts]);
      if (r[0].n !== allCasts.length) throw validation('この店舗に登録されていないキャストが含まれています。');
    }
    let imported = 0;
    for (const it of v.items) {
      const r = await q.query<{ id: string }>(
        `INSERT INTO archive_links(store_id, title, url, description, shot_on, purpose, source, external_id, mime_type, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'drive',$7,$8,$9)
         ON CONFLICT (store_id, external_id) WHERE external_id IS NOT NULL AND voided_at IS NULL DO NOTHING RETURNING id`,
        [storeId, it.title, it.url, it.description, it.shotOn, it.purpose, it.externalId, it.mimeType, actor.userId],
      );
      if (!r[0]) continue;
      imported++;
      for (const c of unique(it.castIds)) await q.query('INSERT INTO archive_link_casts(link_id, cast_id, store_id) VALUES ($1,$2,$3)', [r[0].id, c, storeId]);
    }
    return { imported, skipped: v.items.length - imported };
  });
}
