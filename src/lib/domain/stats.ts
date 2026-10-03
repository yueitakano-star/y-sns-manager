import type { Queryable } from '../db';
import type { Actor } from '../access';
import { requireRole } from '../access';
import { notFound } from '../errors';
import type { Period } from '../jst';

/** 有効 = 取り消し(論理削除)されていない個別素材 / 投稿。使用済み = 有効な「投稿済み」投稿に紐付く素材（重複なし） */
const VALID_ITEMS = `
  SELECT i.id, i.media_kind, i.status, b.shot_on, b.category
    FROM material_items i JOIN material_batches b ON b.id = i.batch_id
   WHERE i.store_id = $1 AND i.voided_at IS NULL AND b.voided_at IS NULL`;
const USED_ITEMS = `
  SELECT DISTINCT pm.item_id FROM post_materials pm JOIN posts p ON p.id = pm.post_id
   WHERE p.store_id = $1 AND p.voided_at IS NULL AND p.status = 'published'`;
const SCHED_ITEMS = `
  SELECT DISTINCT pm.item_id FROM post_materials pm JOIN posts p ON p.id = pm.post_id
   WHERE p.store_id = $1 AND p.voided_at IS NULL AND p.status = 'scheduled'`;
// 有効な「回答済み」記録（撮影回・回答とも取消されていない）
const VALID_ANSWERS = `
  SELECT a.cast_id, a.question_id, a.status, a.answered_on, a.session_id, qs.set_number, qs.id AS set_id
    FROM answer_records a
    JOIN interview_sessions s ON s.id = a.session_id
    JOIN questions qu ON qu.id = a.question_id
    JOIN question_sets qs ON qs.id = qu.question_set_id
   WHERE a.store_id = $1 AND a.voided_at IS NULL AND s.voided_at IS NULL`;

function periodParams(period: Period): [string | null, string | null] {
  return period.kind === 'all' ? [null, null] : [period.from, period.to];
}

export interface CastStatRow {
  id: string;
  display_name: string;
  furigana: string | null;
  status: 'active' | 'inactive';
  sort_order: number | null;
  images: number;
  videos: number;
  others: number;
  used_images: number;
  used_videos: number;
  used_others: number;
  total_items: number;
  used_items: number;
  unused_items: number;
  unused_ready: number;
  scheduled_items: number;
  published_posts: number;
  scheduled_posts: number;
  last_shot: string | null;
  last_published: string | null;
  answered_questions: number;
  done_sets: number;
  takes: number;
  posted_interview_sets: number;
}

/** キャスト別集計。素材・回答は現在の全期間、投稿件数のみ期間で絞る */
export async function castStats(q: Queryable, actor: Actor, storeId: string, period: Period): Promise<CastStatRow[]> {
  await requireRole(q, actor, storeId, 'viewer');
  const [from, to] = periodParams(period);
  const inPeriod = (col: string) => `($2::timestamptz IS NULL OR (${col} >= $2::timestamptz AND ${col} < $3::timestamptz))`;
  return q.query<CastStatRow>(
    `WITH vi AS (${VALID_ITEMS}),
     used AS (${USED_ITEMS}),
     sched AS (${SCHED_ITEMS}),
     ic AS (
       SELECT DISTINCT c.cast_id, vi.id AS item_id, vi.media_kind, vi.status, vi.shot_on,
              (u.item_id IS NOT NULL) AS is_used, (s.item_id IS NOT NULL) AS is_sched
         FROM material_item_casts c JOIN vi ON vi.id = c.item_id
         LEFT JOIN used u ON u.item_id = vi.id LEFT JOIN sched s ON s.item_id = vi.id),
     mat AS (
       SELECT cast_id,
              count(*) FILTER (WHERE media_kind='image')::int AS images,
              count(*) FILTER (WHERE media_kind='video')::int AS videos,
              count(*) FILTER (WHERE media_kind='other')::int AS others,
              count(*) FILTER (WHERE is_used AND media_kind='image')::int AS used_images,
              count(*) FILTER (WHERE is_used AND media_kind='video')::int AS used_videos,
              count(*) FILTER (WHERE is_used AND media_kind='other')::int AS used_others,
              count(*)::int AS total_items,
              count(*) FILTER (WHERE is_used)::int AS used_items,
              count(*) FILTER (WHERE NOT is_used)::int AS unused_items,
              count(*) FILTER (WHERE NOT is_used AND status='ready')::int AS unused_ready,
              count(*) FILTER (WHERE is_sched)::int AS scheduled_items,
              max(shot_on)::text AS last_shot
         FROM ic GROUP BY cast_id),
     pst AS (
       SELECT pc.cast_id,
              count(DISTINCT p.id) FILTER (WHERE p.status='published' AND ${inPeriod('p.published_at')})::int AS published_posts,
              count(DISTINCT p.id) FILTER (WHERE p.status='scheduled' AND ${inPeriod('p.scheduled_at')})::int AS scheduled_posts,
              max(p.published_at) FILTER (WHERE p.status='published') AS last_published
         FROM post_casts pc JOIN posts p ON p.id = pc.post_id
        WHERE p.store_id = $1 AND p.voided_at IS NULL GROUP BY pc.cast_id),
     va AS (${VALID_ANSWERS}),
     ans AS (SELECT cast_id, count(DISTINCT question_id)::int AS answered_questions FROM va WHERE status='answered' GROUP BY cast_id),
     setdone AS (
       SELECT cast_id, count(*)::int AS done_sets FROM (
         SELECT cast_id, set_number FROM va WHERE status='answered'
          GROUP BY cast_id, set_number HAVING count(DISTINCT question_id) = 3) t GROUP BY cast_id),
     takes AS (
       SELECT p.cast_id, count(*)::int AS takes
         FROM interview_participants p JOIN interview_sessions s ON s.id = p.session_id
        WHERE s.store_id = $1 AND s.voided_at IS NULL GROUP BY p.cast_id),
     posted_sets AS (
       SELECT cast_id, count(DISTINCT set_number)::int AS posted_interview_sets FROM (
         SELECT ic2.cast_id, qs.set_number
           FROM post_materials pm
           JOIN posts p ON p.id = pm.post_id AND p.status='published' AND p.voided_at IS NULL
           JOIN vi ON vi.id = pm.item_id
           JOIN material_items i ON i.id = vi.id
           JOIN interview_sessions s ON s.batch_id = i.batch_id AND s.voided_at IS NULL
           JOIN question_sets qs ON qs.id = s.question_set_id
           JOIN material_item_casts ic2 ON ic2.item_id = i.id
          WHERE p.store_id = $1) t GROUP BY cast_id)
     SELECT c.id, c.display_name, c.furigana, c.status, c.sort_order,
            coalesce(mat.images,0) AS images, coalesce(mat.videos,0) AS videos, coalesce(mat.others,0) AS others,
            coalesce(mat.used_images,0) AS used_images, coalesce(mat.used_videos,0) AS used_videos, coalesce(mat.used_others,0) AS used_others,
            coalesce(mat.total_items,0) AS total_items, coalesce(mat.used_items,0) AS used_items,
            coalesce(mat.unused_items,0) AS unused_items, coalesce(mat.unused_ready,0) AS unused_ready,
            coalesce(mat.scheduled_items,0) AS scheduled_items,
            coalesce(pst.published_posts,0) AS published_posts, coalesce(pst.scheduled_posts,0) AS scheduled_posts,
            mat.last_shot, pst.last_published,
            coalesce(ans.answered_questions,0) AS answered_questions, coalesce(setdone.done_sets,0) AS done_sets,
            coalesce(takes.takes,0) AS takes, coalesce(posted_sets.posted_interview_sets,0) AS posted_interview_sets
       FROM casts c
       LEFT JOIN mat ON mat.cast_id = c.id LEFT JOIN pst ON pst.cast_id = c.id
       LEFT JOIN ans ON ans.cast_id = c.id LEFT JOIN setdone ON setdone.cast_id = c.id
       LEFT JOIN takes ON takes.cast_id = c.id LEFT JOIN posted_sets ON posted_sets.cast_id = c.id
      WHERE c.store_id = $1 AND c.deleted_at IS NULL
      ORDER BY (c.status='active') DESC, c.sort_order NULLS LAST, c.furigana NULLS LAST, c.display_name`,
    [storeId, from, to],
  );
}

export interface StoreStats {
  items: { total: number; images: number; videos: number; others: number };
  used: number;
  unused: number;
  unusedReady: number;
  scheduledAssigned: number;
  byCategory: { category: string; images: number; videos: number; others: number; total: number }[];
  posts: { published: number; scheduled: number; draft: number; cancelled: number };
  publishedByPlatform: { platform: string; n: number }[];
  publishedUnlinked: number;
  castCount: { active: number; inactive: number };
  interview: { answeredQuestionsTotal: number; doneSetsTotal: number };
  common: { items: number; images: number; videos: number; others: number; publishedPosts: number };
}

export async function storeStats(q: Queryable, actor: Actor, storeId: string, period: Period): Promise<StoreStats> {
  await requireRole(q, actor, storeId, 'viewer');
  const [from, to] = periodParams(period);
  const inPeriod = (col: string) => `($2::timestamptz IS NULL OR (${col} >= $2::timestamptz AND ${col} < $3::timestamptz))`;
  const itemRows = await q.query<{ media_kind: string; category: string; is_used: boolean; is_sched: boolean; status: string; n: number }>(
    `WITH vi AS (${VALID_ITEMS}), used AS (${USED_ITEMS}), sched AS (${SCHED_ITEMS})
     SELECT vi.media_kind, vi.category, (u.item_id IS NOT NULL) AS is_used, (s.item_id IS NOT NULL) AS is_sched, vi.status, count(*)::int AS n
       FROM vi LEFT JOIN used u ON u.item_id = vi.id LEFT JOIN sched s ON s.item_id = vi.id
      GROUP BY 1,2,3,4,5`,
    [storeId],
  );
  const items = { total: 0, images: 0, videos: 0, others: 0 };
  let used = 0;
  let unusedReady = 0;
  let scheduledAssigned = 0;
  const cat = new Map<string, { category: string; images: number; videos: number; others: number; total: number }>();
  for (const r of itemRows) {
    items.total += r.n;
    const k = r.media_kind === 'image' ? 'images' : r.media_kind === 'video' ? 'videos' : 'others';
    items[k] += r.n;
    if (r.is_used) used += r.n;
    if (!r.is_used && r.status === 'ready') unusedReady += r.n;
    if (!r.is_used && r.is_sched) scheduledAssigned += r.n;
    const c = cat.get(r.category) ?? { category: r.category, images: 0, videos: 0, others: 0, total: 0 };
    c[k] += r.n;
    c.total += r.n;
    cat.set(r.category, c);
  }
  const postRows = await q.query<{ status: string; platform: string; unlinked: boolean; n: number }>(
    `SELECT p.status, p.platform, NOT EXISTS (SELECT 1 FROM post_materials pm WHERE pm.post_id = p.id) AS unlinked, count(*)::int AS n
       FROM posts p
      WHERE p.store_id = $1 AND p.voided_at IS NULL
        AND (p.status IN ('draft','cancelled')
             OR (p.status = 'published' AND ${inPeriod('p.published_at')})
             OR (p.status = 'scheduled' AND ${inPeriod('p.scheduled_at')}))
      GROUP BY 1,2,3`,
    [storeId, from, to],
  );
  const posts = { published: 0, scheduled: 0, draft: 0, cancelled: 0 };
  const byPlatform = new Map<string, number>();
  let publishedUnlinked = 0;
  for (const r of postRows) {
    posts[r.status as keyof typeof posts] += r.n;
    if (r.status === 'published') {
      byPlatform.set(r.platform, (byPlatform.get(r.platform) ?? 0) + r.n);
      if (r.unlinked) publishedUnlinked += r.n;
    }
  }
  const castCount = (
    await q.query<{ status: string; n: number }>(
      'SELECT status, count(*)::int AS n FROM casts WHERE store_id=$1 AND deleted_at IS NULL GROUP BY status',
      [storeId],
    )
  ).reduce((a, r) => ({ ...a, [r.status]: r.n }), { active: 0, inactive: 0 } as { active: number; inactive: number });
  const stats = await castStats(q, actor, storeId, period);
  const common = (
    await q.query<{ media_kind: string; n: number }>(
      `WITH vi AS (${VALID_ITEMS})
       SELECT vi.media_kind, count(*)::int AS n FROM vi
        WHERE NOT EXISTS (SELECT 1 FROM material_item_casts c WHERE c.item_id = vi.id) GROUP BY 1`,
      [storeId],
    )
  ).reduce(
    (a, r) => {
      a.items += r.n;
      a[r.media_kind === 'image' ? 'images' : r.media_kind === 'video' ? 'videos' : 'others'] += r.n;
      return a;
    },
    { items: 0, images: 0, videos: 0, others: 0, publishedPosts: 0 },
  );
  common.publishedPosts = (
    await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM posts p
        WHERE p.store_id=$1 AND p.voided_at IS NULL AND p.status='published' AND ${inPeriod('p.published_at')}
          AND NOT EXISTS (SELECT 1 FROM post_casts pc WHERE pc.post_id = p.id)`,
      [storeId, from, to],
    )
  )[0].n;
  return {
    items,
    used,
    unused: items.total - used,
    unusedReady,
    scheduledAssigned,
    byCategory: [...cat.values()],
    posts,
    publishedByPlatform: [...byPlatform].map(([platform, n]) => ({ platform, n })),
    publishedUnlinked,
    castCount,
    interview: {
      answeredQuestionsTotal: stats.reduce((a, c) => a + c.answered_questions, 0),
      doneSetsTotal: stats.reduce((a, c) => a + c.done_sets, 0),
    },
    common,
  };
}

export type SetState = 'none' | 'noanswer' | 'partial' | 'done';
export interface SetCell {
  setNumber: number;
  takes: number;
  answered: number;
  passed: number;
  state: SetState;
  posted: boolean;
  lastAnsweredOn: string | null;
}
export interface SetInfo {
  id: string;
  set_number: number;
  title: string;
  questions: { id: string; position: number; text: string }[];
}

export async function listQuestionSets(q: Queryable): Promise<SetInfo[]> {
  const sets = await q.query<{ id: string; set_number: number; title: string }>(
    'SELECT id, set_number, title FROM question_sets WHERE version = (SELECT max(version) FROM question_sets x WHERE x.set_number = question_sets.set_number) ORDER BY set_number',
  );
  const qs = await q.query<{ id: string; question_set_id: string; position: number; text: string }>(
    'SELECT id, question_set_id, position, text FROM questions ORDER BY position',
  );
  return sets.map((s) => ({
    ...s,
    questions: qs.filter((x) => x.question_set_id === s.id).map((x) => ({ id: x.id, position: x.position, text: x.text })),
  }));
}

/** キャスト×セットの進捗。回答済み=異なる質問の重複なし。パスは回答扱いにしない */
export async function questionProgress(
  q: Queryable,
  actor: Actor,
  storeId: string,
  castId?: string,
): Promise<Record<string, Record<number, SetCell>>> {
  await requireRole(q, actor, storeId, 'viewer');
  const castFilter = castId ? 'AND cast_id = $2' : 'AND ($2::uuid IS NULL OR true)';
  const p: unknown[] = [storeId, castId ?? null];
  const answered = await q.query<{ cast_id: string; set_number: number; answered: number; passed: number; last_on: string | null }>(
    `WITH va AS (${VALID_ANSWERS}),
     qstate AS (
       SELECT cast_id, set_number, question_id,
              bool_or(status='answered') AS ans, bool_or(status='passed') AS pas,
              max(answered_on) FILTER (WHERE status='answered') AS last_on
         FROM va WHERE true ${castFilter} GROUP BY cast_id, set_number, question_id)
     SELECT cast_id, set_number,
            count(*) FILTER (WHERE ans)::int AS answered,
            count(*) FILTER (WHERE pas AND NOT ans)::int AS passed,
            max(last_on)::text AS last_on
       FROM qstate GROUP BY cast_id, set_number`,
    p,
  );
  const takes = await q.query<{ cast_id: string; set_number: number; takes: number }>(
    `SELECT pa.cast_id, qs.set_number, count(DISTINCT s.id)::int AS takes
       FROM interview_participants pa JOIN interview_sessions s ON s.id = pa.session_id
       JOIN question_sets qs ON qs.id = s.question_set_id
      WHERE s.store_id = $1 AND s.voided_at IS NULL ${castId ? 'AND pa.cast_id = $2' : 'AND ($2::uuid IS NULL OR true)'}
      GROUP BY pa.cast_id, qs.set_number`,
    p,
  );
  const posted = await q.query<{ cast_id: string; set_number: number }>(
    `SELECT DISTINCT ic.cast_id, qs.set_number
       FROM post_materials pm
       JOIN posts po ON po.id = pm.post_id AND po.status='published' AND po.voided_at IS NULL
       JOIN material_items i ON i.id = pm.item_id AND i.voided_at IS NULL
       JOIN material_batches b ON b.id = i.batch_id AND b.voided_at IS NULL
       JOIN interview_sessions s ON s.batch_id = b.id AND s.voided_at IS NULL
       JOIN question_sets qs ON qs.id = s.question_set_id
       JOIN material_item_casts ic ON ic.item_id = i.id
      WHERE po.store_id = $1 ${castId ? 'AND ic.cast_id = $2' : 'AND ($2::uuid IS NULL OR true)'}`,
    p,
  );
  const out: Record<string, Record<number, SetCell>> = {};
  const cell = (c: string, n: number): SetCell => {
    out[c] ??= {};
    return (out[c][n] ??= { setNumber: n, takes: 0, answered: 0, passed: 0, state: 'none', posted: false, lastAnsweredOn: null });
  };
  for (const t of takes) cell(t.cast_id, t.set_number).takes = t.takes;
  for (const a of answered) {
    const c = cell(a.cast_id, a.set_number);
    c.answered = a.answered;
    c.passed = a.passed;
    c.lastAnsweredOn = a.last_on;
  }
  for (const pp of posted) cell(pp.cast_id, pp.set_number).posted = true;
  for (const byCast of Object.values(out)) {
    for (const c of Object.values(byCast)) {
      c.state = c.answered >= 3 ? 'done' : c.answered > 0 ? 'partial' : c.takes > 0 ? 'noanswer' : 'none';
    }
  }
  return out;
}

export interface AnswerHistoryRow {
  id: string;
  session_id: string;
  batch_id: string | null;
  set_number: number;
  set_title: string;
  position: number;
  question_text: string;
  status: 'unanswered' | 'answered' | 'passed';
  answered_on: string | null;
  shot_on: string;
  take_no: number;
}

export async function answerHistory(q: Queryable, actor: Actor, storeId: string, castId: string): Promise<AnswerHistoryRow[]> {
  await requireRole(q, actor, storeId, 'viewer');
  if (!/^[0-9a-f-]{36}$/i.test(castId)) throw notFound('キャスト');
  return q.query<AnswerHistoryRow>(
    `SELECT a.id, a.session_id, s.batch_id, qs.set_number, qs.title AS set_title, qu.position,
            a.question_text_snapshot AS question_text, a.status, a.answered_on, s.shot_on, s.take_no
       FROM answer_records a
       JOIN interview_sessions s ON s.id = a.session_id
       JOIN questions qu ON qu.id = a.question_id
       JOIN question_sets qs ON qs.id = qu.question_set_id
      WHERE a.store_id = $1 AND a.cast_id = $2 AND a.voided_at IS NULL AND s.voided_at IS NULL
      ORDER BY qs.set_number, s.shot_on, s.take_no, qu.position`,
    [storeId, castId],
  );
}
