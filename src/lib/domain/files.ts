import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db, Queryable } from '../db';
import type { Actor } from '../access';
import { requireRole } from '../access';
import { AppError, notFound, validation } from '../errors';
import type { StorageApi } from '../storage';
import { idStr, parseInput } from './util';

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'video/mp4', 'video/quicktime', 'video/webm'];
export const maxUploadBytes = () => (Number(process.env.MAX_UPLOAD_MB) || 2048) * 1024 * 1024;

const fileMeta = z.object({
  name: z.string().trim().min(1, 'ファイル名がありません。').max(200),
  type: z.string(),
  size: z.number().int().positive('空のファイルは登録できません。'),
});

function checkFile(f: { name: string; type: string; size: number }) {
  if (!ALLOWED_TYPES.includes(f.type)) throw validation(`「${f.name}」は対応していない形式です（画像: JPEG/PNG/WebP/GIF/HEIC、動画: MP4/MOV/WebM）。`);
  if (f.size > maxUploadBytes()) throw validation(`「${f.name}」が大きすぎます（上限 ${Math.round(maxUploadBytes() / 1024 / 1024)}MB）。`);
}

const safeName = (n: string) => n.replace(/[^\w.\-ぁ-んァ-ヶ一-龠]/g, '_').slice(-80) || 'file';

async function assertItem(q: Queryable, storeId: string, itemId: string) {
  const r = await q.query(
    `SELECT 1 FROM material_items i JOIN material_batches b ON b.id=i.batch_id
      WHERE i.id=$1 AND i.store_id=$2 AND i.voided_at IS NULL AND b.voided_at IS NULL`,
    [itemId, storeId],
  );
  if (!r.length) throw notFound('個別素材');
}

/** アップロード前の検証と、ブラウザ直送用の署名付きURLの発行。DBにはまだ登録しない */
export async function prepareUpload(db: Db, storage: StorageApi, actor: Actor, storeId: string, itemId: string, file: unknown) {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('個別素材'), itemId);
  if (!storage.configured()) throw new AppError('validation', 'ファイルの保存先（Supabase Storage）が未設定です。管理者に環境変数の設定を依頼してください。');
  const f = parseInput(fileMeta, file);
  checkFile(f);
  await assertItem(db, storeId, itemId);
  const path = `${storeId}/${itemId}/${randomUUID()}-${safeName(f.name)}`;
  return { path, uploadUrl: await storage.createUploadUrl(path) };
}

/** アップロード完了後にファイルを記録する（パスは自店舗・対象素材のものだけ受け付ける） */
export async function registerFile(db: Db, actor: Actor, storeId: string, itemId: string, input: unknown): Promise<string> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('個別素材'), itemId);
  const v = parseInput(fileMeta.extend({ path: z.string().max(400) }), input);
  checkFile(v);
  if (!v.path.startsWith(`${storeId}/${itemId}/`) || v.path.includes('..')) throw validation('ファイルの保存先が正しくありません。');
  return db.tx(async (q) => {
    await assertItem(q, storeId, itemId);
    const r = await q.query<{ id: string }>(
      `INSERT INTO material_files(store_id, item_id, storage_path, file_name, content_type, size_bytes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (storage_path) DO UPDATE SET voided_at = NULL RETURNING id`,
      [storeId, itemId, v.path, v.name, v.type, v.size, actor.userId],
    );
    return r[0].id;
  });
}

export async function removeFile(db: Db, storage: StorageApi, actor: Actor, storeId: string, fileId: string): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('ファイル'), fileId);
  const r = await db.query<{ storage_path: string }>(
    'UPDATE material_files SET voided_at = now() WHERE id=$1 AND store_id=$2 AND voided_at IS NULL RETURNING storage_path',
    [fileId, storeId],
  );
  if (!r[0]) throw notFound('ファイル');
  await storage.remove(r[0].storage_path);
}

export interface FileRow {
  id: string;
  item_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
}

export async function listFiles(q: Queryable, actor: Actor, storeId: string, itemIds: string[]): Promise<FileRow[]> {
  await requireRole(q, actor, storeId, 'viewer');
  if (!itemIds.length) return [];
  return q.query<FileRow>(
    `SELECT id, item_id, file_name, content_type, size_bytes, storage_path FROM material_files
      WHERE store_id=$1 AND voided_at IS NULL AND item_id = ANY($2::uuid[]) ORDER BY created_at`,
    [storeId, itemIds],
  );
}

export interface CoverFile {
  batch_id: string;
  storage_path: string;
  content_type: string;
}

/** 素材グループごとの代表ファイル（画像を優先して1つ）。グリッド表示用 */
export async function listCoverFiles(q: Queryable, actor: Actor, storeId: string, batchIds: string[]): Promise<CoverFile[]> {
  await requireRole(q, actor, storeId, 'viewer');
  if (!batchIds.length) return [];
  return q.query<CoverFile>(
    `SELECT DISTINCT ON (i.batch_id) i.batch_id, f.storage_path, f.content_type
       FROM material_files f JOIN material_items i ON i.id = f.item_id
      WHERE f.store_id = $1 AND f.voided_at IS NULL AND i.voided_at IS NULL AND i.batch_id = ANY($2::uuid[])
      ORDER BY i.batch_id, (f.content_type LIKE 'image/%') DESC, f.created_at`,
    [storeId, batchIds],
  );
}
