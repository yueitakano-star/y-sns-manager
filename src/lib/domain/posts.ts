import { z } from 'zod';
import type { Db, Queryable } from '../db';
import type { Actor } from '../access';
import { requireRole } from '../access';
import { AppError, notFound, validation } from '../errors';
import type { PostCategoryKey, PostStatus, Platform } from '../constants';
import { fromJstLocal } from '../jst';
import { idStr, optStr, parseInput, reqStr, unique, urlOpt } from './util';

const PLATFORM_KEYS = ['instagram', 'tiktok', 'other'] as const;
const POST_STATUS_KEYS = ['draft', 'scheduled', 'published', 'cancelled'] as const;

/** 'YYYY-MM-DDTHH:mm'(日本時間) または ISO8601 を ISO(UTC)へ。不正は null */
function toInstant(v: string | null | undefined): string | null | 'invalid' {
  if (!v) return null;
  const local = fromJstLocal(v);
  if (local) return local;
  const d = new Date(v);
  return /[zZ]|[+-]\d\d:\d\d$/.test(v) && !Number.isNaN(d.getTime()) ? d.toISOString() : 'invalid';
}

const targetSchema = z.object({
  platform: z.enum(PLATFORM_KEYS, { error: '投稿先を選択してください。' }),
  format: optStr('投稿形式', 40),
  status: z.enum(POST_STATUS_KEYS, { error: '状態を選択してください。' }),
  scheduledAt: z.string().nullish(),
  publishedAt: z.string().nullish(),
  url: urlOpt('投稿URL'),
  publicStateNote: optStr('公開状態のメモ', 500),
});

const commonSchema = z.object({
  requestKey: z.string().min(8).max(100).nullish(),
  category: z.enum(['interview', 'self_pr', 'brand_video', 'daily_photo', 'other', 'quiz'], { error: '系統を選択してください。' }),
  quizSetId: idStr('クイズセット').nullish(),
  otherLabel: optStr('内容名', 60),
  questionSetId: idStr('質問セット').nullish(),
  title: reqStr('タイトル', 120),
  itemIds: z.array(idStr('素材')).max(200).default([]),
  castIds: z.array(idStr('キャスト')).max(50).default([]),
  caption: optStr('キャプション', 5000),
  memo: optStr('メモ', 2000),
});

const createSchema = commonSchema.extend({
  targets: z.array(targetSchema).min(1, '投稿先を1つ以上選択してください。').max(3),
});
const updateSchema = commonSchema.extend({ target: targetSchema });

export type CreatePostInput = z.input<typeof createSchema>;
export type UpdatePostInput = z.input<typeof updateSchema>;

type Target = z.output<typeof targetSchema>;

function resolveTarget(t: Target, label: string, now: Date) {
  const sched = toInstant(t.scheduledAt);
  const pub = toInstant(t.publishedAt);
  if (sched === 'invalid') throw validation('予定日時の形式が正しくありません。', { scheduledAt: '日時を確認してください。' });
  if (pub === 'invalid') throw validation('投稿日時の形式が正しくありません。', { publishedAt: '日時を確認してください。' });
  if (t.status === 'scheduled' && !sched) {
    throw validation(`${label}：投稿予定には予定日時が必要です。`, { scheduledAt: '予定日時を入力してください。' });
  }
  if (t.status === 'published') {
    if (!pub) throw validation(`${label}：投稿済みには実際の投稿日時が必要です。`, { publishedAt: '実際の投稿日時を入力してください。' });
    if (new Date(pub).getTime() > now.getTime()) {
      throw validation(`${label}：投稿済みの日時に未来は指定できません。これから投稿する場合は「投稿予定」にして予定日時を入力してください。`, {
        publishedAt: '未来の日時です。「投稿予定」に変更してください。',
      });
    }
  }
  return {
    scheduledAt: sched,
    publishedAt: t.status === 'published' ? pub : null,
  };
}

async function assertRelations(
  q: Queryable,
  storeId: string,
  p: { itemIds: string[]; castIds: string[]; questionSetId?: string | null; quizSetId?: string | null },
): Promise<void> {
  if (p.itemIds.length) {
    const r = await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM material_items i JOIN material_batches b ON b.id=i.batch_id
        WHERE i.store_id=$1 AND i.voided_at IS NULL AND b.voided_at IS NULL AND i.id = ANY($2::uuid[])`,
      [storeId, p.itemIds],
    );
    if (r[0].n !== p.itemIds.length) throw validation('この店舗の素材ではないもの、または取り消された素材が含まれています。', { itemIds: '素材の選択を確認してください。' });
  }
  if (p.castIds.length) {
    const r = await q.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM casts WHERE store_id=$1 AND deleted_at IS NULL AND id = ANY($2::uuid[])',
      [storeId, p.castIds],
    );
    if (r[0].n !== p.castIds.length) throw validation('この店舗に登録されていないキャストが含まれています。', { castIds: 'キャストの選択を確認してください。' });
  }
  if (p.quizSetId) {
    const r = await q.query('SELECT 1 FROM quiz_sets WHERE id=$1', [p.quizSetId]);
    if (!r.length) throw validation('クイズセットが正しくありません。', { quizSetId: 'クイズセットを選択してください。' });
  }
  if (p.questionSetId) {
    const r = await q.query('SELECT 1 FROM question_sets WHERE id=$1', [p.questionSetId]);
    if (!r.length) throw validation('質問セットが正しくありません。', { questionSetId: '質問セットを選択してください。' });
  }
}

function assertNoDuplicate(ids: string[], what: string, field: string): string[] {
  if (new Set(ids).size !== ids.length) throw validation(`同じ${what}を重複して選択しています。`, { [field]: `${what}が重複しています。` });
  return ids;
}

async function replaceLinks(q: Queryable, storeId: string, postId: string, itemIds: string[], castIds: string[]): Promise<void> {
  await q.query('DELETE FROM post_materials WHERE post_id=$1', [postId]);
  await q.query('DELETE FROM post_casts WHERE post_id=$1', [postId]);
  for (const id of itemIds) await q.query('INSERT INTO post_materials(post_id, item_id, store_id) VALUES ($1,$2,$3)', [postId, id, storeId]);
  for (const id of castIds) await q.query('INSERT INTO post_casts(post_id, cast_id, store_id) VALUES ($1,$2,$3)', [postId, id, storeId]);
}

export async function createPosts(
  db: Db,
  actor: Actor,
  storeId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<{ postIds: string[]; groupId: string; duplicate: boolean }> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(createSchema, input);
  if (v.category === 'other' && !v.otherLabel) throw validation('内容名を入力してください。', { otherLabel: '「その他」は内容名の入力が必要です。' });
  assertNoDuplicate(v.itemIds, '素材', 'itemIds');
  assertNoDuplicate(v.castIds, 'キャスト', 'castIds');
  const platforms = v.targets.map((t) => t.platform);
  if (new Set(platforms).size !== platforms.length) throw validation('同じ投稿先が重複しています。', { targets: '投稿先が重複しています。' });
  const resolved = v.targets.map((t) => resolveTarget(t, t.platform, now));

  return db.tx(async (q) => {
    if (v.requestKey) {
      const ex = await q.query<{ id: string; post_group_id: string; store_id: string }>(
        `SELECT id, post_group_id, store_id FROM posts WHERE request_key = $1 ORDER BY created_at`,
        [`${v.requestKey}:0`],
      );
      if (ex[0]) {
        if (ex[0].store_id !== storeId) throw validation('不正なリクエストです。');
        const all = await q.query<{ id: string }>('SELECT id FROM posts WHERE post_group_id=$1 ORDER BY created_at', [ex[0].post_group_id]);
        return { postIds: all.map((r) => r.id), groupId: ex[0].post_group_id, duplicate: true };
      }
    }
    await assertRelations(q, storeId, { itemIds: v.itemIds, castIds: v.castIds, questionSetId: v.questionSetId, quizSetId: v.quizSetId });
    const g = await q.query<{ id: string }>('SELECT gen_random_uuid() AS id');
    const groupId = g[0].id;
    const postIds: string[] = [];
    for (let i = 0; i < v.targets.length; i++) {
      const t = v.targets[i];
      const r = resolved[i];
      const rows = await q.query<{ id: string }>(
        `INSERT INTO posts(store_id, post_group_id, category, other_label, question_set_id, title, platform, format, status,
                           scheduled_at, published_at, original_scheduled_at, url, caption, memo, public_state_note, request_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [
          storeId, groupId, v.category, v.otherLabel, v.questionSetId ?? null, v.title, t.platform, t.format, t.status,
          r.scheduledAt, r.publishedAt, t.url, v.caption, v.memo, t.publicStateNote,
          v.requestKey ? `${v.requestKey}:${i}` : null, actor.userId,
        ],
      );
      postIds.push(rows[0].id);
      if (v.category === 'quiz' && v.quizSetId) await q.query('UPDATE posts SET quiz_set_id=$2 WHERE id=$1', [rows[0].id, v.quizSetId]);
      await replaceLinks(q, storeId, rows[0].id, v.itemIds, v.castIds);
    }
    return { postIds, groupId, duplicate: false };
  });
}

/** 既存の投稿を更新する（予定→投稿済みも同じレコードを更新し、二重計上しない） */
export async function updatePost(db: Db, actor: Actor, storeId: string, postId: string, input: unknown, now: Date = new Date()): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('投稿'), postId);
  const v = parseInput(updateSchema, input);
  if (v.category === 'other' && !v.otherLabel) throw validation('内容名を入力してください。', { otherLabel: '「その他」は内容名の入力が必要です。' });
  assertNoDuplicate(v.itemIds, '素材', 'itemIds');
  assertNoDuplicate(v.castIds, 'キャスト', 'castIds');
  const r = resolveTarget(v.target, '投稿', now);
  await db.tx(async (q) => {
    const cur = await q.query<{ id: string; scheduled_at: string | null; original_scheduled_at: string | null }>(
      'SELECT id, scheduled_at, original_scheduled_at FROM posts WHERE id=$1 AND store_id=$2 AND voided_at IS NULL FOR UPDATE',
      [postId, storeId],
    );
    if (!cur[0]) throw notFound('投稿');
    await assertRelations(q, storeId, { itemIds: v.itemIds, castIds: v.castIds, questionSetId: v.questionSetId, quizSetId: v.quizSetId });
    // 予定日の履歴: 最初に予定として設定された日時を original_scheduled_at に保持する
    const scheduledAt = r.scheduledAt ?? (v.target.status === 'published' ? cur[0].scheduled_at : null);
    const original = cur[0].original_scheduled_at ?? scheduledAt ?? cur[0].scheduled_at;
    await q.query(
      `UPDATE posts SET category=$3, other_label=$4, question_set_id=$5, title=$6, platform=$7, format=$8, status=$9,
              scheduled_at=$10, published_at=$11, original_scheduled_at=$12, url=$13, caption=$14, memo=$15,
              public_state_note=$16, updated_at=now()
        WHERE id=$1 AND store_id=$2`,
      [
        postId, storeId, v.category, v.otherLabel, v.questionSetId ?? null, v.title, v.target.platform, v.target.format, v.target.status,
        scheduledAt, r.publishedAt, original, v.target.url, v.caption, v.memo, v.target.publicStateNote,
      ],
    );
    await q.query('UPDATE posts SET quiz_set_id=$2 WHERE id=$1', [postId, v.category === 'quiz' ? (v.quizSetId ?? null) : null]);
    await replaceLinks(q, storeId, postId, v.itemIds, v.castIds);
  });
}

/** 誤登録の取消（論理削除）。SNS側で後から消えた投稿は取消ではなく公開状態メモで残す */
export async function voidPost(db: Db, actor: Actor, storeId: string, postId: string, reason: unknown): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('投稿'), postId);
  const why = parseInput(reqStr('取消の理由', 200), reason);
  const rows = await db.query(
    'UPDATE posts SET voided_at=now(), void_reason=$3, updated_at=now() WHERE id=$1 AND store_id=$2 AND voided_at IS NULL RETURNING id',
    [postId, storeId, why],
  );
  if (!rows[0]) throw notFound('投稿');
}

// ---------- 読み取り ----------

export interface PostRow {
  id: string;
  post_group_id: string;
  category: PostCategoryKey;
  other_label: string | null;
  question_set_id: string | null;
  set_label: string | null;
  quiz_set_id: string | null;
  quiz_label: string | null;
  title: string;
  platform: Platform;
  format: string | null;
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  original_scheduled_at: string | null;
  url: string | null;
  caption: string | null;
  memo: string | null;
  public_state_note: string | null;
  created_at: string;
  material_count: number;
  cast_names: string[];
  cast_ids: string[];
  item_ids: string[];
  item_codes: string[];
}

const POST_SELECT = `
  p.id, p.post_group_id, p.category, p.other_label, p.question_set_id, p.title, p.platform, p.format, p.status,
  p.scheduled_at, p.published_at, p.original_scheduled_at, p.url, p.caption, p.memo, p.public_state_note, p.created_at, p.quiz_set_id,
  (SELECT 'QUIZ ' || lpad(qz.set_number::text,2,'0') || '｜' || qz.title FROM quiz_sets qz WHERE qz.id=p.quiz_set_id) AS quiz_label,
  (SELECT 'SET ' || lpad(qs.set_number::text,2,'0') || '｜' || qs.title FROM question_sets qs WHERE qs.id=p.question_set_id) AS set_label,
  (SELECT count(*)::int FROM post_materials pm JOIN material_items i ON i.id=pm.item_id WHERE pm.post_id=p.id) AS material_count,
  coalesce((SELECT array_agg(c.display_name ORDER BY c.display_name) FROM post_casts pc JOIN casts c ON c.id=pc.cast_id WHERE pc.post_id=p.id), ARRAY[]::text[]) AS cast_names,
  coalesce((SELECT array_agg(c.id ORDER BY c.display_name) FROM post_casts pc JOIN casts c ON c.id=pc.cast_id WHERE pc.post_id=p.id), ARRAY[]::uuid[]) AS cast_ids,
  coalesce((SELECT array_agg(i.id ORDER BY i.code) FROM post_materials pm JOIN material_items i ON i.id=pm.item_id WHERE pm.post_id=p.id), ARRAY[]::uuid[]) AS item_ids,
  coalesce((SELECT array_agg(i.code ORDER BY i.code) FROM post_materials pm JOIN material_items i ON i.id=pm.item_id WHERE pm.post_id=p.id), ARRAY[]::text[]) AS item_codes`;

export interface PostFilter {
  status?: string;
  platform?: string;
  category?: string;
  castId?: string;
  from?: string; // 実投稿日時/予定日時の範囲(ISO, [from,to))
  to?: string;
  unlinkedOnly?: boolean;
}

export async function listPosts(q: Queryable, actor: Actor, storeId: string, f: PostFilter = {}): Promise<PostRow[]> {
  await requireRole(q, actor, storeId, 'viewer');
  const params: unknown[] = [storeId];
  const where = ['p.store_id=$1', 'p.voided_at IS NULL'];
  const add = (sql: string, val: unknown) => {
    params.push(val);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.status && (POST_STATUS_KEYS as readonly string[]).includes(f.status)) add('p.status = ?', f.status);
  if (f.platform && (PLATFORM_KEYS as readonly string[]).includes(f.platform)) add('p.platform = ?', f.platform);
  if (f.category) add('p.category = ?', f.category);
  if (f.castId && /^[0-9a-f-]{36}$/i.test(f.castId)) add('EXISTS (SELECT 1 FROM post_casts pc WHERE pc.post_id=p.id AND pc.cast_id = ?)', f.castId);
  if (f.from) add('coalesce(p.published_at, p.scheduled_at, p.created_at) >= ?', f.from);
  if (f.to) add('coalesce(p.published_at, p.scheduled_at, p.created_at) < ?', f.to);
  if (f.unlinkedOnly) where.push('NOT EXISTS (SELECT 1 FROM post_materials pm WHERE pm.post_id=p.id)');
  return q.query<PostRow>(
    `SELECT ${POST_SELECT} FROM posts p WHERE ${where.join(' AND ')}
      ORDER BY coalesce(p.published_at, p.scheduled_at, p.created_at) DESC`,
    params,
  );
}

export async function getPost(q: Queryable, actor: Actor, storeId: string, postId: string): Promise<PostRow & { siblings: { id: string; platform: Platform; status: PostStatus }[] }> {
  await requireRole(q, actor, storeId, 'viewer');
  if (!/^[0-9a-f-]{36}$/i.test(postId)) throw notFound('投稿');
  const rows = await q.query<PostRow>(`SELECT ${POST_SELECT} FROM posts p WHERE p.id=$1 AND p.store_id=$2 AND p.voided_at IS NULL`, [postId, storeId]);
  if (!rows[0]) throw notFound('投稿');
  const siblings = await q.query<{ id: string; platform: Platform; status: PostStatus }>(
    'SELECT id, platform, status FROM posts WHERE post_group_id=$1 AND id <> $2 AND voided_at IS NULL',
    [rows[0].post_group_id, postId],
  );
  return { ...rows[0], siblings };
}

export function isUnlinked(p: Pick<PostRow, 'material_count'>): boolean {
  return p.material_count === 0;
}

export { AppError };
