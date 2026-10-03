import { z } from 'zod';
import type { Db, Queryable } from '../db';
import type { Actor } from '../access';
import { requireRole } from '../access';
import { AppError, notFound, validation } from '../errors';
import { CATEGORY_BY_KEY, setLabel, type CategoryKey, type MaterialStatus, type MediaKind } from '../constants';
import { jstToday } from '../jst';
import { dateStr, idStr, optStr, parseInput, reqStr, unique, urlOpt } from './util';

const MAX_QTY = 500;
const CATEGORY_KEYS = [
  'interview',
  'self_pr_image',
  'self_pr_video',
  'brand_video',
  'daily_photo',
  'event_material',
  'other',
] as const;
const MEDIA = ['image', 'video', 'other'] as const;
const STATUSES = ['captured', 'editing', 'ready', 'unusable'] as const;

const qtySchema = z
  .number({ error: '数量は数字で入力してください。' })
  .int('数量は整数で入力してください。（小数は使えません）')
  .min(1, '数量は1以上の整数で入力してください。')
  .max(MAX_QTY, `数量は${MAX_QTY}以下で入力してください。`);

const requestKey = z.string().min(8).max(100).nullish();
const purposeSchema = z.enum(['sns', 'ad', 'other'], { error: '用途を選択してください。' }).nullish().transform((v) => v ?? null);

const materialSchema = z.object({
  requestKey,
  category: z.enum(CATEGORY_KEYS, { error: '素材の種類を選択してください。' }),
  purpose: purposeSchema,
  otherLabel: optStr('内容名', 60),
  mediaKind: z.enum(MEDIA, { error: '画像／動画／その他を選択してください。' }),
  quantity: qtySchema,
  castIds: z.array(idStr('キャスト')).max(50).default([]),
  shotOn: dateStr('撮影・作成日'),
  title: reqStr('タイトル', 120),
  status: z.enum(STATUSES, { error: '作業状態を選択してください。' }).default('captured'),
  storageUrl: urlOpt('保存場所URL'),
  memo: optStr('メモ', 2000),
});

const interviewSchema = z.object({
  requestKey,
  shotOn: dateStr('撮影日'),
  setId: idStr('質問セット'),
  castIds: z.array(idStr('キャスト')).min(1, '出演キャストを1人以上選択してください。').max(10),
  takeNo: z.number().int().min(1, '撮影回は1以上で入力してください。').max(999).nullish(),
  videoCount: qtySchema.default(1),
  title: optStr('タイトル', 120),
  status: z.enum(STATUSES).default('captured'),
  storageUrl: urlOpt('保存場所URL'),
  memo: optStr('メモ', 2000),
  answers: z
    .array(
      z.object({
        castId: idStr('キャスト'),
        questionId: idStr('質問'),
        status: z.enum(['unanswered', 'answered', 'passed']),
        answeredOn: dateStr('回答日').nullish(),
        videoNo: z.number().int().min(1).nullish(),
      }),
    )
    .default([]),
});

export type MaterialInput = z.input<typeof materialSchema>;
export type InterviewInput = z.input<typeof interviewSchema>;

const pad = (n: number, w: number) => String(n).padStart(w, '0');

async function assertCasts(q: Queryable, storeId: string, castIds: string[]): Promise<void> {
  if (!castIds.length) return;
  const rows = await q.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM casts WHERE store_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])',
    [storeId, castIds],
  );
  if (rows[0].n !== castIds.length) throw validation('この店舗に登録されていないキャストが含まれています。', { castIds: '選択したキャストを確認してください。' });
}

async function nextSeq(q: Queryable, storeId: string, scope: string): Promise<number> {
  const rows = await q.query<{ value: number }>(
    `INSERT INTO counters(store_id, scope, value) VALUES ($1,$2,1)
     ON CONFLICT (store_id, scope) DO UPDATE SET value = counters.value + 1 RETURNING value`,
    [storeId, scope],
  );
  return rows[0].value;
}

async function insertItems(
  q: Queryable,
  p: { storeId: string; batchId: string; displayCode: string; from: number; count: number; mediaKind: MediaKind; status: MaterialStatus; castIds: string[]; storageUrl?: string | null },
): Promise<string[]> {
  const ids: string[] = [];
  const width = Math.max(2, String(p.from + p.count - 1).length);
  for (let i = 0; i < p.count; i++) {
    const seq = p.from + i;
    const rows = await q.query<{ id: string }>(
      `INSERT INTO material_items(batch_id, store_id, seq, code, media_kind, status, storage_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [p.batchId, p.storeId, seq, `${p.displayCode}-${pad(seq, width)}`, p.mediaKind, p.status, p.storageUrl ?? null],
    );
    ids.push(rows[0].id);
    for (const c of p.castIds) {
      await q.query('INSERT INTO material_item_casts(item_id, cast_id, store_id) VALUES ($1,$2,$3)', [rows[0].id, c, p.storeId]);
    }
  }
  return ids;
}

async function createBatchRow(
  q: Queryable,
  actor: Actor,
  p: {
    storeId: string;
    category: CategoryKey;
    otherLabel: string | null;
    purpose?: string | null;
    mediaKind: MediaKind;
    title: string;
    shotOn: string;
    status: MaterialStatus;
    storageUrl: string | null;
    memo: string | null;
    requestKey: string | null;
  },
): Promise<{ id: string; displayCode: string }> {
  const stores = await q.query<{ code: string }>('SELECT code FROM stores WHERE id = $1', [p.storeId]);
  const catCode = CATEGORY_BY_KEY[p.category].code;
  const seq = await nextSeq(q, p.storeId, `batch:${catCode}`);
  const displayCode = `${stores[0].code}-${catCode}-${pad(seq, 4)}`;
  const rows = await q.query<{ id: string }>(
    `INSERT INTO material_batches(store_id, category, other_label, media_kind, display_code, seq, title, shot_on, status, storage_url, memo, request_key, created_by, purpose)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [p.storeId, p.category, p.otherLabel, p.mediaKind, displayCode, seq, p.title, p.shotOn, p.status, p.storageUrl, p.memo, p.requestKey, actor.userId, p.purpose ?? null],
  );
  return { id: rows[0].id, displayCode };
}

function assertNotFuture(date: string, label: string, field: string): void {
  if (date > jstToday()) throw validation(`${label}に未来の日付は指定できません。`, { [field]: '未来の日付は指定できません。' });
}

export interface CreatedBatch {
  batchId: string;
  displayCode: string;
  itemCount: number;
  /** 個別素材のID（番号順）。登録直後のファイルアップロードに使う */
  itemIds: string[];
  duplicate: boolean;
}

async function findByRequestKey(q: Queryable, storeId: string, key: string | null | undefined): Promise<CreatedBatch | null> {
  if (!key) return null;
  const rows = await q.query<{ id: string; display_code: string; n: number; store_id: string }>(
    `SELECT b.id, b.display_code, b.store_id, (SELECT count(*)::int FROM material_items i WHERE i.batch_id = b.id) AS n
       FROM material_batches b WHERE b.request_key = $1`,
    [key],
  );
  if (!rows[0]) return null;
  if (rows[0].store_id !== storeId) throw validation('不正なリクエストです。');
  const ids = await q.query<{ id: string }>('SELECT id FROM material_items WHERE batch_id = $1 AND voided_at IS NULL ORDER BY seq', [rows[0].id]);
  return { batchId: rows[0].id, displayCode: rows[0].display_code, itemCount: rows[0].n, itemIds: ids.map((r) => r.id), duplicate: true };
}

/** インタビュー以外の素材を、数量ぶんの個別素材としてまとめて登録する（素材グループ1件＋個別素材N件を1トランザクション） */
export async function createMaterial(db: Db, actor: Actor, storeId: string, input: unknown): Promise<CreatedBatch> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(materialSchema, input);
  if (v.category === 'interview') throw validation('インタビュー撮影は専用の登録フォームから登録してください。', { category: '種類を確認してください。' });
  const cat = CATEGORY_BY_KEY[v.category];
  if (!cat.allowed_media_kinds.includes(v.mediaKind)) {
    throw validation(`「${cat.name}」に指定できない形式です。`, { mediaKind: `「${cat.name}」では選べない形式です。` });
  }
  if (v.category === 'other' && !v.otherLabel) throw validation('内容名を入力してください。', { otherLabel: '「その他」は内容名の入力が必要です。' });
  assertNotFuture(v.shotOn, '撮影・作成日', 'shotOn');
  const castIds = unique(v.castIds);
  return db.tx(async (q) => {
    const dup = await findByRequestKey(q, storeId, v.requestKey);
    if (dup) return dup;
    await assertCasts(q, storeId, castIds);
    const b = await createBatchRow(q, actor, {
      storeId,
      category: v.category,
      otherLabel: v.otherLabel,
      purpose: v.purpose,
      mediaKind: v.mediaKind,
      title: v.title,
      shotOn: v.shotOn,
      status: v.status,
      storageUrl: v.storageUrl,
      memo: v.memo,
      requestKey: v.requestKey ?? null,
    });
    const created = await insertItems(q, { storeId, batchId: b.id, displayCode: b.displayCode, from: 1, count: v.quantity, mediaKind: v.mediaKind, status: v.status, castIds });
    return { batchId: b.id, displayCode: b.displayCode, itemCount: v.quantity, itemIds: created, duplicate: false };
  });
}

/** インタビュー撮影を登録：動画素材グループ＋撮影回＋出演者＋質問ごとの回答記録 */
export async function createInterviewShoot(db: Db, actor: Actor, storeId: string, input: unknown): Promise<CreatedBatch & { sessionId: string }> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(interviewSchema, input);
  assertNotFuture(v.shotOn, '撮影日', 'shotOn');
  const castIds = unique(v.castIds);
  const today = jstToday();
  return db.tx(async (q) => {
    const dupRows = await q.query<{ id: string }>(
      `SELECT s.id FROM interview_sessions s JOIN material_batches b ON b.id = s.batch_id WHERE b.request_key = $1`,
      [v.requestKey ?? null],
    );
    const dup = await findByRequestKey(q, storeId, v.requestKey);
    if (dup) return { ...dup, sessionId: dupRows[0]?.id ?? '' };

    await assertCasts(q, storeId, castIds);
    const sets = await q.query<{ id: string; set_number: number; title: string }>(
      'SELECT id, set_number, title FROM question_sets WHERE id = $1',
      [v.setId],
    );
    if (!sets[0]) throw validation('質問セットが正しくありません。', { setId: '質問セットを選択してください。' });
    const questions = await q.query<{ id: string; text: string }>(
      'SELECT id, text FROM questions WHERE question_set_id = $1 ORDER BY position',
      [v.setId],
    );
    const qById = new Map(questions.map((x) => [x.id, x.text]));
    const seen = new Set<string>();
    for (const a of v.answers) {
      if (!castIds.includes(a.castId)) throw validation('回答の対象キャストが出演者に含まれていません。');
      if (!qById.has(a.questionId)) throw validation('このセットに含まれない質問が指定されています。');
      const k = `${a.castId}:${a.questionId}`;
      if (seen.has(k)) throw validation('同じ質問の回答が重複しています。');
      seen.add(k);
      if (a.status === 'answered') {
        const d = a.answeredOn ?? v.shotOn;
        if (d > today) throw validation('回答日に未来の日付は指定できません。');
        if (d < v.shotOn) throw validation('回答日は撮影日以降にしてください。');
      }
      if (a.videoNo && a.videoNo > v.videoCount) throw validation('回答に紐付ける動画の番号が範囲外です。');
    }

    let takeNo = v.takeNo ?? null;
    if (!takeNo) {
      const r = await q.query<{ n: number }>(
        `SELECT coalesce(max(s.take_no), 0)::int AS n
           FROM interview_sessions s JOIN interview_participants p ON p.session_id = s.id
          WHERE s.store_id = $1 AND s.question_set_id = $2 AND s.voided_at IS NULL AND p.cast_id = ANY($3::uuid[])`,
        [storeId, v.setId, castIds],
      );
      takeNo = r[0].n + 1;
    }
    const label = setLabel(sets[0].set_number, sets[0].title);
    const b = await createBatchRow(q, actor, {
      storeId,
      category: 'interview',
      otherLabel: null,
      mediaKind: 'video',
      title: v.title ?? `${label} 撮影${takeNo}回目`,
      shotOn: v.shotOn,
      status: v.status,
      storageUrl: v.storageUrl,
      memo: v.memo,
      requestKey: v.requestKey ?? null,
    });
    const itemIds = await insertItems(q, { storeId, batchId: b.id, displayCode: b.displayCode, from: 1, count: v.videoCount, mediaKind: 'video', status: v.status, castIds });
    const sess = await q.query<{ id: string }>(
      `INSERT INTO interview_sessions(store_id, batch_id, question_set_id, shot_on, take_no, memo, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [storeId, b.id, v.setId, v.shotOn, takeNo, v.memo, actor.userId],
    );
    const sessionId = sess[0].id;
    for (const c of castIds) {
      await q.query('INSERT INTO interview_participants(session_id, cast_id, store_id) VALUES ($1,$2,$3)', [sessionId, c, storeId]);
      for (const qu of questions) {
        const a = v.answers.find((x) => x.castId === c && x.questionId === qu.id);
        const status = a?.status ?? 'unanswered';
        const answeredOn = status === 'answered' ? (a?.answeredOn ?? v.shotOn) : null;
        const itemId = status === 'answered' ? itemIds[(a?.videoNo ?? 1) - 1] : null;
        await q.query(
          `INSERT INTO answer_records(store_id, session_id, cast_id, question_id, question_text_snapshot, status, answered_on, material_item_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [storeId, sessionId, c, qu.id, qu.text, status, answeredOn, itemId],
        );
      }
    }
    return { batchId: b.id, displayCode: b.displayCode, itemCount: v.videoCount, itemIds, duplicate: false, sessionId };
  });
}

const setAnswerSchema = z.object({
  sessionId: idStr('撮影回'),
  castId: idStr('キャスト'),
  questionId: idStr('質問'),
  status: z.enum(['unanswered', 'answered', 'passed'], { error: '回答状態を選択してください。' }),
  answeredOn: dateStr('回答日').nullish(),
});

/** 回答状態を更新（後日回答・パスの変更）。同じ記録を更新するので回答数は二重に増えない */
export async function setAnswer(db: Db, actor: Actor, storeId: string, input: unknown): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(setAnswerSchema, input);
  await db.tx(async (q) => {
    const rows = await q.query<{ id: string; shot_on: string }>(
      `SELECT a.id, s.shot_on FROM answer_records a JOIN interview_sessions s ON s.id = a.session_id
        WHERE a.session_id=$1 AND a.cast_id=$2 AND a.question_id=$3 AND a.store_id=$4
          AND a.voided_at IS NULL AND s.voided_at IS NULL`,
      [v.sessionId, v.castId, v.questionId, storeId],
    );
    if (!rows[0]) throw notFound('回答記録');
    let on: string | null = null;
    if (v.status === 'answered') {
      on = v.answeredOn ?? rows[0].shot_on;
      if (on > jstToday()) throw validation('回答日に未来の日付は指定できません。', { answeredOn: '未来の日付は指定できません。' });
      if (on < rows[0].shot_on) throw validation('回答日は撮影日以降にしてください。', { answeredOn: '撮影日以降の日付にしてください。' });
    }
    await q.query('UPDATE answer_records SET status=$2, answered_on=$3, updated_at=now() WHERE id=$1', [rows[0].id, v.status, on]);
  });
}

/** 明示的な一括チェック：指定キャストの3問を回答済みにする */
export async function markAllAnswered(db: Db, actor: Actor, storeId: string, input: { sessionId: string; castId: string; answeredOn?: string | null }): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('撮影回'), input.sessionId);
  parseInput(idStr('キャスト'), input.castId);
  const qs = await db.query<{ question_id: string }>(
    `SELECT a.question_id FROM answer_records a JOIN interview_sessions s ON s.id = a.session_id
      WHERE a.session_id=$1 AND a.cast_id=$2 AND a.store_id=$3 AND a.voided_at IS NULL AND s.voided_at IS NULL`,
    [input.sessionId, input.castId, storeId],
  );
  if (!qs.length) throw notFound('回答記録');
  for (const r of qs) {
    await setAnswer(db, actor, storeId, { sessionId: input.sessionId, castId: input.castId, questionId: r.question_id, status: 'answered', answeredOn: input.answeredOn });
  }
}

const batchUpdateSchema = z.object({
  title: reqStr('タイトル', 120),
  shotOn: dateStr('撮影・作成日'),
  status: z.enum(STATUSES, { error: '作業状態を選択してください。' }),
  applyStatusToItems: z.boolean().default(false),
  purpose: purposeSchema,
  otherLabel: optStr('内容名', 60),
  storageUrl: urlOpt('保存場所URL'),
  memo: optStr('メモ', 2000),
});

/** 素材グループの編集。NGにしても回答履歴は残る（回答は answer_records が別に保持） */
export async function updateBatch(db: Db, actor: Actor, storeId: string, batchId: string, input: unknown): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('素材'), batchId);
  const v = parseInput(batchUpdateSchema, input);
  assertNotFuture(v.shotOn, '撮影・作成日', 'shotOn');
  await db.tx(async (q) => {
    const rows = await q.query<{ category: CategoryKey }>(
      `UPDATE material_batches SET title=$3, shot_on=$4, status=$5, other_label=$6, storage_url=$7, memo=$8, purpose=$9, updated_at=now()
        WHERE id=$1 AND store_id=$2 AND voided_at IS NULL RETURNING category`,
      [batchId, storeId, v.title, v.shotOn, v.status, v.otherLabel, v.storageUrl, v.memo, v.purpose],
    );
    if (!rows[0]) throw notFound('素材');
    if (rows[0].category === 'other' && !v.otherLabel) throw validation('内容名を入力してください。', { otherLabel: '「その他」は内容名の入力が必要です。' });
    if (v.applyStatusToItems) {
      await q.query('UPDATE material_items SET status=$2, updated_at=now() WHERE batch_id=$1 AND voided_at IS NULL', [batchId, v.status]);
    }
    // インタビュー撮影日は撮影回にも反映（回答日が撮影日より前にならないよう検証）
    await q.query('UPDATE interview_sessions SET shot_on=$2, updated_at=now() WHERE batch_id=$1', [batchId, v.shotOn]);
  });
}

const itemUpdateSchema = z.object({
  status: z.enum(STATUSES, { error: '作業状態を選択してください。' }),
  memo: optStr('メモ', 1000),
  storageUrl: urlOpt('保存場所URL'),
});

export async function updateItem(db: Db, actor: Actor, storeId: string, itemId: string, input: unknown): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('個別素材'), itemId);
  const v = parseInput(itemUpdateSchema, input);
  const rows = await db.query(
    `UPDATE material_items SET status=$3, memo=$4, storage_url=$5, updated_at=now()
      WHERE id=$1 AND store_id=$2 AND voided_at IS NULL RETURNING id`,
    [itemId, storeId, v.status, v.memo, v.storageUrl],
  );
  if (!rows[0]) throw notFound('個別素材');
}

/** 登録後の個別素材の追加（番号は既存の続き。採番を振り直さない） */
export async function addItems(db: Db, actor: Actor, storeId: string, batchId: string, count: unknown): Promise<number> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('素材'), batchId);
  const n = parseInput(qtySchema, count);
  return db.tx(async (q) => {
    const b = await q.query<{ display_code: string; media_kind: MediaKind; status: MaterialStatus; storage_url: string | null }>(
      'SELECT display_code, media_kind, status, storage_url FROM material_batches WHERE id=$1 AND store_id=$2 AND voided_at IS NULL FOR UPDATE',
      [batchId, storeId],
    );
    if (!b[0]) throw notFound('素材');
    const mx = await q.query<{ n: number }>('SELECT coalesce(max(seq),0)::int AS n FROM material_items WHERE batch_id=$1', [batchId]);
    const casts = await q.query<{ cast_id: string }>(
      `SELECT DISTINCT ic.cast_id FROM material_item_casts ic JOIN material_items i ON i.id = ic.item_id
        WHERE i.batch_id = $1 AND i.voided_at IS NULL`,
      [batchId],
    );
    await insertItems(q, { storeId, batchId, displayCode: b[0].display_code, from: mx[0].n + 1, count: n, mediaKind: b[0].media_kind, status: b[0].status, castIds: casts.map((c) => c.cast_id), storageUrl: null });
    return n;
  });
}

const voidSchema = z.object({
  itemIds: z.array(idStr('個別素材')).min(1, '取り消す個別素材を選択してください。'),
  reason: reqStr('取消の理由', 200),
});

/** 数量減・誤登録の取消：対象を明示して除外。投稿に使われた素材は黙って消せない */
export async function voidItems(db: Db, actor: Actor, storeId: string, input: unknown): Promise<number> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(voidSchema, input);
  const ids = unique(v.itemIds);
  return db.tx(async (q) => {
    const used = await q.query<{ code: string }>(
      `SELECT DISTINCT i.code FROM material_items i
         JOIN post_materials pm ON pm.item_id = i.id JOIN posts p ON p.id = pm.post_id
        WHERE i.store_id=$1 AND i.id = ANY($2::uuid[]) AND p.voided_at IS NULL`,
      [storeId, ids],
    );
    if (used.length) {
      throw new AppError('conflict', `投稿に紐付いている素材は取り消せません（${used.map((u) => u.code).join('、')}）。先に投稿側の紐付けを外すか、投稿を取り消してください。`);
    }
    const rows = await q.query(
      `UPDATE material_items SET voided_at=now(), void_reason=$3, updated_at=now()
        WHERE store_id=$1 AND id = ANY($2::uuid[]) AND voided_at IS NULL RETURNING id`,
      [storeId, ids, v.reason],
    );
    if (rows.length !== ids.length) throw notFound('個別素材');
    return rows.length;
  });
}

/** 素材グループごとの誤登録取消。インタビューなら撮影回と回答記録も集計から除外される */
export async function voidBatch(db: Db, actor: Actor, storeId: string, batchId: string, reason: unknown): Promise<void> {
  await requireRole(db, actor, storeId, 'editor');
  parseInput(idStr('素材'), batchId);
  const why = parseInput(reqStr('取消の理由', 200), reason);
  await db.tx(async (q) => {
    const used = await q.query<{ code: string }>(
      `SELECT DISTINCT i.code FROM material_items i
         JOIN post_materials pm ON pm.item_id = i.id JOIN posts p ON p.id = pm.post_id
        WHERE i.store_id=$1 AND i.batch_id=$2 AND i.voided_at IS NULL AND p.voided_at IS NULL`,
      [storeId, batchId],
    );
    if (used.length) {
      throw new AppError('conflict', `投稿に紐付いている素材があるため取り消せません（${used.map((u) => u.code).join('、')}）。先に投稿を取り消すか、紐付けを外してください。`);
    }
    const rows = await q.query(
      `UPDATE material_batches SET voided_at=now(), void_reason=$3, updated_at=now()
        WHERE id=$1 AND store_id=$2 AND voided_at IS NULL RETURNING id`,
      [batchId, storeId, why],
    );
    if (!rows[0]) throw notFound('素材');
    await q.query('UPDATE material_items SET voided_at=now(), void_reason=$3, updated_at=now() WHERE batch_id=$1 AND store_id=$2 AND voided_at IS NULL', [batchId, storeId, `グループ取消: ${why}`]);
    await q.query(
      `UPDATE answer_records SET voided_at=now(), updated_at=now()
        WHERE store_id=$2 AND voided_at IS NULL AND session_id IN (SELECT id FROM interview_sessions WHERE batch_id=$1)`,
      [batchId, storeId],
    );
    await q.query('UPDATE interview_sessions SET voided_at=now(), void_reason=$3, updated_at=now() WHERE batch_id=$1 AND store_id=$2 AND voided_at IS NULL', [batchId, storeId, why]);
  });
}

const derivedSchema = z.object({
  sourceItemId: idStr('元の素材'),
  castIds: z.array(idStr('キャスト')).min(1, '写っているキャストを1人以上選択してください。'),
  memo: optStr('メモ', 500),
});

/** 複数人の素材から一部のキャストだけを切り出した「派生素材」を同じグループに追加する */
export async function createDerivedItem(db: Db, actor: Actor, storeId: string, input: unknown): Promise<string> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(derivedSchema, input);
  const castIds = unique(v.castIds);
  return db.tx(async (q) => {
    const src = await q.query<{ id: string; batch_id: string; media_kind: MediaKind; status: MaterialStatus; code: string }>(
      `SELECT i.id, i.batch_id, i.media_kind, i.status, i.code FROM material_items i JOIN material_batches b ON b.id = i.batch_id
        WHERE i.id=$1 AND i.store_id=$2 AND i.voided_at IS NULL AND b.voided_at IS NULL`,
      [v.sourceItemId, storeId],
    );
    if (!src[0]) throw notFound('元の素材');
    await assertCasts(q, storeId, castIds);
    const b = await q.query<{ display_code: string }>('SELECT display_code FROM material_batches WHERE id=$1', [src[0].batch_id]);
    const mx = await q.query<{ n: number }>('SELECT coalesce(max(seq),0)::int AS n FROM material_items WHERE batch_id=$1', [src[0].batch_id]);
    const [id] = await insertItems(q, { storeId, batchId: src[0].batch_id, displayCode: b[0].display_code, from: mx[0].n + 1, count: 1, mediaKind: src[0].media_kind, status: src[0].status, castIds });
    await q.query('UPDATE material_items SET derived_from_item_id=$2, memo=$3 WHERE id=$1', [id, src[0].id, v.memo ?? `${src[0].code} からの切り出し`]);
    return id;
  });
}

// ---------- 読み取り ----------

export interface BatchListRow {
  id: string;
  display_code: string;
  category: CategoryKey;
  other_label: string | null;
  media_kind: MediaKind;
  title: string;
  shot_on: string;
  status: MaterialStatus;
  item_count: number;
  used_count: number;
  cast_names: string[];
  question_set_label: string | null;
  purpose: 'sns' | 'ad' | 'other' | null;
}

export interface BatchFilter {
  category?: string;
  castId?: string;
  status?: string;
  usage?: 'all' | 'unused' | 'used';
  common?: boolean;
  purpose?: string;
}

export async function listBatches(q: Queryable, actor: Actor, storeId: string, f: BatchFilter = {}): Promise<BatchListRow[]> {
  await requireRole(q, actor, storeId, 'viewer');
  const params: unknown[] = [storeId];
  const where: string[] = ['b.store_id = $1', 'b.voided_at IS NULL'];
  if (f.category && f.category in CATEGORY_BY_KEY) {
    params.push(f.category);
    where.push(`b.category = $${params.length}`);
  }
  if (f.status && (STATUSES as readonly string[]).includes(f.status)) {
    params.push(f.status);
    where.push(`b.status = $${params.length}`);
  }
  if (f.purpose && ['sns', 'ad', 'other'].includes(f.purpose)) {
    params.push(f.purpose);
    where.push(`b.purpose = $${params.length}`);
  }
  if (f.castId && /^[0-9a-f-]{36}$/i.test(f.castId)) {
    params.push(f.castId);
    where.push(`EXISTS (SELECT 1 FROM material_items i JOIN material_item_casts ic ON ic.item_id=i.id WHERE i.batch_id=b.id AND i.voided_at IS NULL AND ic.cast_id=$${params.length})`);
  }
  if (f.common) {
    where.push(`NOT EXISTS (SELECT 1 FROM material_items i JOIN material_item_casts ic ON ic.item_id=i.id WHERE i.batch_id=b.id AND i.voided_at IS NULL)`);
  }
  const rows = await q.query<BatchListRow & { used_count: number }>(
    `SELECT b.id, b.display_code, b.category, b.other_label, b.media_kind, b.title, b.shot_on, b.status, b.purpose,
            (SELECT count(*)::int FROM material_items i WHERE i.batch_id=b.id AND i.voided_at IS NULL) AS item_count,
            (SELECT count(DISTINCT i.id)::int FROM material_items i
               JOIN post_materials pm ON pm.item_id=i.id JOIN posts p ON p.id=pm.post_id
              WHERE i.batch_id=b.id AND i.voided_at IS NULL AND p.voided_at IS NULL AND p.status='published') AS used_count,
            coalesce((SELECT array_agg(DISTINCT c.display_name) FROM material_items i
               JOIN material_item_casts ic ON ic.item_id=i.id JOIN casts c ON c.id=ic.cast_id
              WHERE i.batch_id=b.id AND i.voided_at IS NULL), ARRAY[]::text[]) AS cast_names,
            (SELECT 'SET ' || lpad(qs.set_number::text,2,'0') || '｜' || qs.title FROM interview_sessions s
               JOIN question_sets qs ON qs.id=s.question_set_id WHERE s.batch_id=b.id AND s.voided_at IS NULL LIMIT 1) AS question_set_label
       FROM material_batches b WHERE ${where.join(' AND ')}
      ORDER BY b.shot_on DESC, b.created_at DESC`,
    params,
  );
  return rows.filter((r) => (f.usage === 'unused' ? r.used_count < r.item_count : f.usage === 'used' ? r.used_count > 0 : true));
}

export interface ItemRow {
  id: string;
  batch_id: string;
  seq: number;
  code: string;
  media_kind: MediaKind;
  status: MaterialStatus;
  memo: string | null;
  storage_url: string | null;
  derived_from_item_id: string | null;
  published_count: number;
  scheduled_count: number;
  cast_ids: string[];
  cast_names: string[];
}

const ITEM_SELECT = `
  i.id, i.batch_id, i.seq, i.code, i.media_kind, i.status, i.memo, i.storage_url, i.derived_from_item_id,
  (SELECT count(DISTINCT p.id)::int FROM post_materials pm JOIN posts p ON p.id=pm.post_id
    WHERE pm.item_id=i.id AND p.voided_at IS NULL AND p.status='published') AS published_count,
  (SELECT count(DISTINCT p.id)::int FROM post_materials pm JOIN posts p ON p.id=pm.post_id
    WHERE pm.item_id=i.id AND p.voided_at IS NULL AND p.status='scheduled') AS scheduled_count,
  coalesce((SELECT array_agg(c.id ORDER BY c.display_name) FROM material_item_casts ic JOIN casts c ON c.id=ic.cast_id WHERE ic.item_id=i.id), ARRAY[]::uuid[]) AS cast_ids,
  coalesce((SELECT array_agg(c.display_name ORDER BY c.display_name) FROM material_item_casts ic JOIN casts c ON c.id=ic.cast_id WHERE ic.item_id=i.id), ARRAY[]::text[]) AS cast_names`;

export interface BatchDetail {
  id: string;
  store_id: string;
  display_code: string;
  category: CategoryKey;
  other_label: string | null;
  media_kind: MediaKind;
  title: string;
  shot_on: string;
  status: MaterialStatus;
  storage_url: string | null;
  memo: string | null;
  purpose: 'sns' | 'ad' | 'other' | null;
  created_at: string;
  items: ItemRow[];
  voidedItems: ItemRow[];
  session: null | {
    id: string;
    take_no: number;
    question_set_id: string;
    set_number: number;
    set_title: string;
    shot_on: string;
    answers: { cast_id: string; cast_name: string; question_id: string; position: number; text: string; status: 'unanswered' | 'answered' | 'passed'; answered_on: string | null }[];
  };
  posts: { id: string; title: string; platform: string; status: string; at: string | null }[];
}

export async function getBatchDetail(q: Queryable, actor: Actor, storeId: string, batchId: string): Promise<BatchDetail> {
  await requireRole(q, actor, storeId, 'viewer');
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw notFound('素材');
  const b = await q.query<Omit<BatchDetail, 'items' | 'voidedItems' | 'session' | 'posts'>>(
    `SELECT id, store_id, display_code, category, other_label, media_kind, title, shot_on, status, storage_url, memo, purpose, created_at
       FROM material_batches WHERE id=$1 AND store_id=$2 AND voided_at IS NULL`,
    [batchId, storeId],
  );
  if (!b[0]) throw notFound('素材');
  const items = await q.query<ItemRow>(`SELECT ${ITEM_SELECT} FROM material_items i WHERE i.batch_id=$1 AND i.voided_at IS NULL ORDER BY i.seq`, [batchId]);
  const voidedItems = await q.query<ItemRow>(`SELECT ${ITEM_SELECT} FROM material_items i WHERE i.batch_id=$1 AND i.voided_at IS NOT NULL ORDER BY i.seq`, [batchId]);
  const sessions = await q.query<{ id: string; take_no: number; question_set_id: string; set_number: number; set_title: string; shot_on: string }>(
    `SELECT s.id, s.take_no, s.question_set_id, qs.set_number, qs.title AS set_title, s.shot_on
       FROM interview_sessions s JOIN question_sets qs ON qs.id=s.question_set_id WHERE s.batch_id=$1 AND s.voided_at IS NULL`,
    [batchId],
  );
  let session: BatchDetail['session'] = null;
  if (sessions[0]) {
    const answers = await q.query<NonNullable<BatchDetail['session']>['answers'][number]>(
      `SELECT a.cast_id, c.display_name AS cast_name, a.question_id, qu.position, a.question_text_snapshot AS text, a.status, a.answered_on
         FROM answer_records a JOIN casts c ON c.id=a.cast_id JOIN questions qu ON qu.id=a.question_id
        WHERE a.session_id=$1 AND a.voided_at IS NULL ORDER BY c.display_name, qu.position`,
      [sessions[0].id],
    );
    session = { ...sessions[0], answers };
  }
  const posts = await q.query<BatchDetail['posts'][number]>(
    `SELECT DISTINCT p.id, p.title, p.platform, p.status, coalesce(p.published_at, p.scheduled_at) AS at
       FROM post_materials pm JOIN material_items i ON i.id=pm.item_id JOIN posts p ON p.id=pm.post_id
      WHERE i.batch_id=$1 AND p.voided_at IS NULL ORDER BY at DESC NULLS LAST`,
    [batchId],
  );
  return { ...b[0], items, voidedItems, session, posts };
}

export interface PickerItem extends ItemRow {
  batch_title: string;
  display_code: string;
  category: CategoryKey;
  shot_on: string;
  set_label: string | null;
  set_id: string | null;
}

/** 投稿登録の素材選択肢（取消されていない個別素材。過去の使用回数つき） */
export async function listPickerItems(q: Queryable, actor: Actor, storeId: string): Promise<PickerItem[]> {
  await requireRole(q, actor, storeId, 'viewer');
  return q.query<PickerItem>(
    `SELECT ${ITEM_SELECT}, b.title AS batch_title, b.display_code, b.category, b.shot_on,
            (SELECT 'SET ' || lpad(qs.set_number::text,2,'0') || '｜' || qs.title FROM interview_sessions s
               JOIN question_sets qs ON qs.id=s.question_set_id WHERE s.batch_id=b.id AND s.voided_at IS NULL LIMIT 1) AS set_label,
            (SELECT s.question_set_id FROM interview_sessions s WHERE s.batch_id=b.id AND s.voided_at IS NULL LIMIT 1) AS set_id
       FROM material_items i JOIN material_batches b ON b.id=i.batch_id
      WHERE i.store_id=$1 AND i.voided_at IS NULL AND b.voided_at IS NULL
      ORDER BY b.shot_on DESC, b.display_code, i.seq`,
    [storeId],
  );
}

const quickSchema = z.object({
  requestKey,
  castId: idStr('キャスト').nullish(),
  memo: optStr('備考', 2000),
  purpose: purposeSchema,
  images: z.number().int().min(0).max(MAX_QTY).default(0),
  videos: z.number().int().min(0).max(MAX_QTY).default(0),
});

/** かんたん投稿: 名前(キャスト)・備考・ファイル数だけで素材を自動登録する（種類は「その他：かんたんアップロード」）。ファイル本体は呼び出し側がアップロードする */
export async function createQuickUpload(
  db: Db,
  actor: Actor,
  storeId: string,
  input: unknown,
): Promise<{ batches: { batchId: string; kind: MediaKind; itemIds: string[] }[] }> {
  await requireRole(db, actor, storeId, 'editor');
  const v = parseInput(quickSchema, input);
  if (v.images + v.videos === 0) throw validation('ファイルを選んでください。', { files: 'ファイルを選んでください。' });
  let who = '店舗共通';
  if (v.castId) {
    const c = await db.query<{ display_name: string }>('SELECT display_name FROM casts WHERE id=$1 AND store_id=$2 AND deleted_at IS NULL', [v.castId, storeId]);
    if (!c[0]) throw validation('この店舗に登録されていないキャストです。', { castId: 'キャストを選び直してください。' });
    who = c[0].display_name;
  }
  const today = jstToday();
  const batches: { batchId: string; kind: MediaKind; itemIds: string[] }[] = [];
  for (const [kind, n] of [['image', v.images], ['video', v.videos]] as const) {
    if (!n) continue;
    const r = await createMaterial(db, actor, storeId, {
      requestKey: v.requestKey ? `${v.requestKey}:${kind}` : null,
      category: 'other',
      purpose: v.purpose ?? 'sns',
      otherLabel: 'かんたんアップロード',
      mediaKind: kind,
      quantity: n,
      castIds: v.castId ? [v.castId] : [],
      shotOn: today,
      title: `${who} ${today} かんたん${kind === 'image' ? '画像' : '動画'}`,
      status: 'captured',
      memo: v.memo,
    });
    batches.push({ batchId: r.batchId, kind, itemIds: r.itemIds });
  }
  return { batches };
}
