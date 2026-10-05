import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedMaster } from '../src/lib/db';
import { createCast, getCast, listCasts, updateCast } from '../src/lib/domain/casts';
import {
  addItems,
  createDerivedItem,
  createInterviewShoot,
  createMaterial,
  createQuickUpload,
  getBatchDetail,
  listBatches,
  markAllAnswered,
  setAnswer,
  updateBatch,
  updateItemsStatus,
  voidBatch,
  voidItems,
} from '../src/lib/domain/materials';
import { createPosts, listPosts, updatePost, voidPost } from '../src/lib/domain/posts';
import { castStats, listQuestionSets, questionProgress, storeStats } from '../src/lib/domain/stats';
import { calendarEvents } from '../src/lib/domain/calendar';
import { AppError } from '../src/lib/errors';
import { parsePeriod } from '../src/lib/jst';
import { resetData, setupEnv, type Env } from './helpers';

let env: Env;
let B: string; // B-club
let K: string; // KINGYO

beforeAll(async () => {
  env = await setupEnv();
  B = env.stores['b-club'];
  K = env.stores['kingyo'];
});
afterAll(async () => {
  await env.db.close();
});
beforeEach(async () => {
  await resetData(env.db);
});

const ALL = parsePeriod({});
const cast = (name: string, store = B) => createCast(env.db, env.admin, store, { displayName: name });
const stat = async (id: string, store = B) => (await castStats(env.db, env.admin, store, ALL)).find((c) => c.id === id)!;
const rejects = async (p: Promise<unknown>, code?: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(AppError);
  if (code) expect((e as AppError).code).toBe(code);
  return e as AppError;
};
const prPhotos = (castId: string, n: number, extra: Record<string, unknown> = {}) =>
  createMaterial(env.db, env.admin, B, {
    category: 'self_pr_image', mediaKind: 'image', quantity: n, castIds: [castId], shotOn: '2025-09-01', title: 'PR画像', status: 'ready', ...extra,
  });
const items = async (batchId: string) => (await getBatchDetail(env.db, env.admin, B, batchId)).items;
const post = (itemIds: string[], castIds: string[], target: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  createPosts(env.db, env.admin, B, { category: 'self_pr', title: 'PR投稿', itemIds, castIds, targets: [target], ...extra });

describe('1. 初期投入', () => {
  it('4店舗・20セット60問があり、再投入しても倍増しない', async () => {
    const count = async (t: string) => (await env.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))[0].n;
    expect(await count('stores')).toBe(4);
    expect(await count('question_sets')).toBe(20);
    expect(await count('questions')).toBe(60);
    await seedMaster(env.db);
    await seedMaster(env.db);
    expect(await count('stores')).toBe(4);
    expect(await count('question_sets')).toBe(20);
    expect(await count('questions')).toBe(60);
    const sets = await listQuestionSets(env.db);
    expect(sets[0].title).toBe('まずは、どんな子？');
    expect(sets[0].questions.map((q) => q.text)[0]).toBe('自分の性格をひと言でいうと？');
  });
  it('再投入しても既存の実績は消えない', async () => {
    const c = await cast('Aさん');
    await seedMaster(env.db);
    expect((await listCasts(env.db, env.admin, B)).map((x) => x.id)).toContain(c.id);
  });
});

describe('2. 店舗の分離と権限 / 18', () => {
  it('他店舗のキャスト・素材は混在しない', async () => {
    await cast('Bの子');
    await cast('Kの子', K);
    expect((await listCasts(env.db, env.admin, B)).map((c) => c.display_name)).toEqual(['Bの子']);
    expect((await listCasts(env.db, env.admin, K)).map((c) => c.display_name)).toEqual(['Kの子']);
  });
  it('権限のない店舗・未所属ユーザーは読み書きとも拒否', async () => {
    const c = await cast('Aさん');
    await rejects(listCasts(env.db, env.editorK, B), 'not_found');
    await rejects(getCast(env.db, env.editorK, B, c.id), 'not_found');
    await rejects(createCast(env.db, env.outsider, B, { displayName: 'x' }), 'not_found');
    await rejects(prPhotos(c.id, 1).then(() => createMaterial(env.db, env.editorK, B, {})), 'not_found');
  });
  it('閲覧専用は登録できない', async () => {
    await rejects(createCast(env.db, env.viewerB, B, { displayName: 'x' }), 'forbidden');
    const c = await cast('Aさん');
    expect((await listCasts(env.db, env.viewerB, B)).length).toBe(1);
    await rejects(updateCast(env.db, env.viewerB, B, c.id, { displayName: 'y' }), 'forbidden');
  });
  it('他店舗のキャストID・素材IDを直接指定しても拒否される', async () => {
    const kCast = await cast('Kの子', K);
    const bCast = await cast('Bの子');
    await rejects(prPhotos(kCast.id, 1), 'validation');
    await rejects(updateCast(env.db, env.admin, B, kCast.id, { displayName: 'x' }), 'not_found');
    const kb = await createMaterial(env.db, env.admin, K, { category: 'daily_photo', mediaKind: 'image', quantity: 2, castIds: [kCast.id], shotOn: '2025-09-01', title: 'K写真' });
    const kItems = (await getBatchDetail(env.db, env.admin, K, kb.batchId)).items;
    await rejects(post([kItems[0].id], [bCast.id], { platform: 'instagram', status: 'draft' }), 'validation');
    await rejects(getBatchDetail(env.db, env.admin, B, kb.batchId), 'not_found');
  });
});

describe('3. キャスト登録・編集', () => {
  it('登録→編集→再取得で保持。退店にしても過去が残る', async () => {
    const c = await createCast(env.db, env.editorB, B, { displayName: 'Aさん', furigana: 'えー', sortOrder: '3', memo: 'メモ' });
    expect(c.sort_order).toBe(3);
    await updateCast(env.db, env.editorB, B, c.id, { displayName: 'Aさん改', status: 'inactive' });
    const again = await getCast(env.db, env.editorB, B, c.id);
    expect(again.display_name).toBe('Aさん改');
    expect(again.status).toBe('inactive');
  });
  it('同名キャストはIDで区別される / 表示名必須 / 不正URL拒否', async () => {
    const a = await cast('同名');
    const b = await cast('同名');
    expect(a.id).not.toBe(b.id);
    await rejects(createCast(env.db, env.admin, B, { displayName: '  ' }), 'validation');
    await rejects(createCast(env.db, env.admin, B, { displayName: 'x', photoUrl: 'javascript:alert(1)' }), 'validation');
  });
});

describe('4-7. 素材と投稿の検算例', () => {
  it('PR画像10枚→個別素材10点、連番つき', async () => {
    const a = await cast('Aさん');
    const b = await prPhotos(a.id, 10);
    expect(b.displayCode).toBe('BCL-PR-0001');
    const its = await items(b.batchId);
    expect(its).toHaveLength(10);
    expect(its[0].code).toBe('BCL-PR-0001-01');
    expect(its[9].code).toBe('BCL-PR-0001-10');
    const b2 = await prPhotos(a.id, 2);
    expect(b2.displayCode).toBe('BCL-PR-0002');
    const s = await stat(a.id);
    expect(s).toMatchObject({ images: 12, total_items: 12, unused_items: 12 });
  });

  it('Instagram3枚→TikTok同3枚→別2枚予定→投稿済みに変更', async () => {
    const a = await cast('Aさん');
    const batch = await prPhotos(a.id, 10);
    const its = await items(batch.batchId);
    const ids = its.map((i) => i.id);

    // 5. Instagram投稿済み1件
    await post(ids.slice(0, 3), [a.id], { platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30' });
    let s = await stat(a.id);
    expect(s).toMatchObject({ images: 10, used_items: 3, unused_items: 7, published_posts: 1, scheduled_posts: 0 });

    // 6. 同じ3枚をTikTokにも
    await post(ids.slice(0, 3), [a.id], { platform: 'tiktok', status: 'published', publishedAt: '2025-09-10T20:00' });
    s = await stat(a.id);
    expect(s).toMatchObject({ used_items: 3, unused_items: 7, published_posts: 2 });

    // 7. 別の2枚を投稿予定
    const sched = await post(ids.slice(3, 5), [a.id], { platform: 'instagram', status: 'scheduled', scheduledAt: '2099-01-01T12:00' });
    s = await stat(a.id);
    expect(s).toMatchObject({ used_items: 3, unused_items: 7, scheduled_items: 2, scheduled_posts: 1, published_posts: 2 });

    // 予定を投稿済みに更新（同じレコード）
    await updatePost(env.db, env.admin, B, sched.postIds[0], {
      category: 'self_pr', title: 'PR投稿', itemIds: ids.slice(3, 5), castIds: [a.id],
      target: { platform: 'instagram', status: 'published', publishedAt: '2025-09-11T12:00' },
    });
    s = await stat(a.id);
    expect(s).toMatchObject({ used_items: 5, unused_items: 5, published_posts: 3, scheduled_posts: 0, scheduled_items: 0 });
    expect(await listPosts(env.db, env.admin, B)).toHaveLength(3);

    const ss = await storeStats(env.db, env.admin, B, ALL);
    expect(ss.items.total).toBe(10);
    expect(ss.used).toBe(5);
    expect(ss.posts.published).toBe(3);
  });

  it('未使用・投稿可能数は作業状態が投稿可能のもののみ。NGは未使用に含まれるが投稿可能ではない', async () => {
    const a = await cast('Aさん');
    const b = await prPhotos(a.id, 4);
    const its = await items(b.batchId);
    const { updateItem } = await import('../src/lib/domain/materials');
    await updateItem(env.db, env.admin, B, its[0].id, { status: 'unusable' });
    await updateItem(env.db, env.admin, B, its[1].id, { status: 'editing' });
    const s = await stat(a.id);
    expect(s.unused_items).toBe(4);
    expect(s.unused_ready).toBe(2);
  });
});

describe('8. 複数キャストの投稿', () => {
  it('A・B両方出演の投稿は、各キャスト1件・店舗1件', async () => {
    const a = await cast('Aさん');
    const b = await cast('Bさん');
    const batch = await createMaterial(env.db, env.admin, B, { category: 'event_material', mediaKind: 'image', quantity: 3, castIds: [a.id, b.id], shotOn: '2025-09-01', title: 'イベント' });
    const its = await items(batch.batchId);
    await post(its.map((i) => i.id), [a.id, b.id], { platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30' }, { category: 'other', otherLabel: 'イベント' });
    expect((await stat(a.id)).published_posts).toBe(1);
    expect((await stat(b.id)).published_posts).toBe(1);
    expect((await stat(a.id)).total_items).toBe(3);
    expect((await storeStats(env.db, env.admin, B, ALL)).posts.published).toBe(1);
  });
});

describe('9-11. インタビュー回答の進捗', () => {
  const firstSet = async () => (await listQuestionSets(env.db))[0];
  const shoot = async (castId: string, answers: ('answered' | 'passed' | 'unanswered')[], extra: Record<string, unknown> = {}) => {
    const set = await firstSet();
    return createInterviewShoot(env.db, env.admin, B, {
      shotOn: '2025-09-01', setId: set.id, castIds: [castId],
      answers: answers.map((status, i) => ({ castId, questionId: set.questions[i].id, status })), ...extra,
    });
  };

  it('9. 2問回答・1問パス→回答2・完了0。後日回答で3問・完了1。再回答しても4にならない', async () => {
    const a = await cast('Aさん');
    const r = await shoot(a.id, ['answered', 'answered', 'passed']);
    let s = await stat(a.id);
    expect(s).toMatchObject({ answered_questions: 2, done_sets: 0, takes: 1 });
    let cells = await questionProgress(env.db, env.admin, B);
    expect(cells[a.id][1]).toMatchObject({ answered: 2, passed: 1, state: 'partial', takes: 1 });

    const set = await firstSet();
    await setAnswer(env.db, env.admin, B, { sessionId: r.sessionId, castId: a.id, questionId: set.questions[2].id, status: 'answered', answeredOn: '2025-09-05' });
    s = await stat(a.id);
    expect(s).toMatchObject({ answered_questions: 3, done_sets: 1 });
    cells = await questionProgress(env.db, env.admin, B);
    expect(cells[a.id][1].state).toBe('done');

    // 同じセットを再撮影して全問再回答 → 質問回答数は3のまま、撮影回数だけ増える
    const r2 = await shoot(a.id, ['answered', 'answered', 'answered'], { shotOn: '2025-09-20' });
    s = await stat(a.id);
    expect(s).toMatchObject({ answered_questions: 3, done_sets: 1, takes: 2 });
    expect(r2.sessionId).not.toBe(r.sessionId);
  });

  it('既定は未回答。勝手に回答済みにならない / 一括チェックは明示操作のみ', async () => {
    const a = await cast('Aさん');
    const r = await shoot(a.id, []);
    expect(await stat(a.id)).toMatchObject({ answered_questions: 0, done_sets: 0, takes: 1 });
    expect((await questionProgress(env.db, env.admin, B))[a.id][1].state).toBe('noanswer');
    await markAllAnswered(env.db, env.admin, B, { sessionId: r.sessionId, castId: a.id });
    expect(await stat(a.id)).toMatchObject({ answered_questions: 3, done_sets: 1 });
  });

  it('10. 複数回の撮影に分かれても3問そろえば完了、撮影回は自動で増える', async () => {
    const a = await cast('Aさん');
    const set = await firstSet();
    const r1 = await createInterviewShoot(env.db, env.admin, B, { shotOn: '2025-09-01', setId: set.id, castIds: [a.id], answers: [{ castId: a.id, questionId: set.questions[0].id, status: 'answered' }] });
    await createInterviewShoot(env.db, env.admin, B, { shotOn: '2025-09-10', setId: set.id, castIds: [a.id], answers: [
      { castId: a.id, questionId: set.questions[1].id, status: 'answered' }, { castId: a.id, questionId: set.questions[2].id, status: 'answered' }] });
    expect(await stat(a.id)).toMatchObject({ answered_questions: 3, done_sets: 1, takes: 2 });
    const sessions = await env.db.query<{ take_no: number }>('SELECT take_no FROM interview_sessions ORDER BY take_no');
    expect(sessions.map((x) => x.take_no)).toEqual([1, 2]);
    expect(r1.itemCount).toBe(1);
  });

  it('11. 素材をNG・編集しても回答履歴は消えない。誤登録の取消だけが集計から除外', async () => {
    const a = await cast('Aさん');
    const r = await shoot(a.id, ['answered', 'answered', 'answered']);
    await updateBatch(env.db, env.admin, B, r.batchId, { title: '編集後', shotOn: '2025-09-01', status: 'unusable', applyStatusToItems: true });
    expect(await stat(a.id)).toMatchObject({ answered_questions: 3, done_sets: 1, takes: 1, unused_ready: 0 });
    await voidBatch(env.db, env.admin, B, r.batchId, '誤登録');
    expect(await stat(a.id)).toMatchObject({ answered_questions: 0, done_sets: 0, takes: 0, total_items: 0 });
  });

  it('未来の回答日・撮影日より前の回答日・別セットの質問は拒否', async () => {
    const a = await cast('Aさん');
    const r = await shoot(a.id, ['answered']);
    const set = await firstSet();
    await rejects(setAnswer(env.db, env.admin, B, { sessionId: r.sessionId, castId: a.id, questionId: set.questions[1].id, status: 'answered', answeredOn: '2099-01-01' }), 'validation');
    await rejects(setAnswer(env.db, env.admin, B, { sessionId: r.sessionId, castId: a.id, questionId: set.questions[1].id, status: 'answered', answeredOn: '2025-08-01' }), 'validation');
    const sets = await listQuestionSets(env.db);
    await rejects(createInterviewShoot(env.db, env.admin, B, { shotOn: '2025-09-01', setId: set.id, castIds: [a.id], answers: [{ castId: a.id, questionId: sets[1].questions[0].id, status: 'answered' }] }), 'validation');
  });

  it('投稿済みインタビューセット数は完了セット数とは別に数える', async () => {
    const a = await cast('Aさん');
    const r = await shoot(a.id, ['answered', 'answered', 'answered']);
    expect((await stat(a.id)).posted_interview_sets).toBe(0);
    const its = await items(r.batchId);
    await post([its[0].id], [a.id], { platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30' }, { category: 'interview' });
    expect(await stat(a.id)).toMatchObject({ done_sets: 1, posted_interview_sets: 1 });
    expect((await questionProgress(env.db, env.admin, B))[a.id][1].posted).toBe(true);
  });
});

describe('12-13. カレンダー', () => {
  it('撮影日・回答日・予定日・実投稿日が正しい日付に出る。JST月末23:59と翌月0:00を区切る', async () => {
    const a = await cast('Aさん');
    const set = (await listQuestionSets(env.db))[0];
    const r = await createInterviewShoot(env.db, env.admin, B, { shotOn: '2025-09-01', setId: set.id, castIds: [a.id], answers: [
      { castId: a.id, questionId: set.questions[0].id, status: 'answered' }, { castId: a.id, questionId: set.questions[1].id, status: 'answered' },
      { castId: a.id, questionId: set.questions[2].id, status: 'passed' }] });
    await setAnswer(env.db, env.admin, B, { sessionId: r.sessionId, castId: a.id, questionId: set.questions[2].id, status: 'answered', answeredOn: '2025-09-05' });
    await prPhotos(a.id, 10, { shotOn: '2025-09-02' });
    const b = await prPhotos(a.id, 2, { shotOn: '2025-09-03' });
    const its = await items(b.batchId);
    await post([its[0].id], [a.id], { platform: 'instagram', status: 'published', publishedAt: '2025-09-30T23:59' });
    await post([its[1].id], [a.id], { platform: 'tiktok', status: 'published', publishedAt: '2025-10-01T00:00' });
    await post([], [a.id], { platform: 'instagram', status: 'scheduled', scheduledAt: '2025-09-15T18:00' });

    const sep = await calendarEvents(env.db, env.admin, B, '2025-09-01', '2025-09-30', '/s/b-club');
    const oct = await calendarEvents(env.db, env.admin, B, '2025-10-01', '2025-10-31', '/s/b-club');
    const at = (evs: typeof sep, date: string) => evs.filter((e) => e.date === date);
    // インタビュー: 撮影日は回答2、後日(9/5)は回答1の別カード
    expect(at(sep, '2025-09-01').find((e) => e.kind === 'interview')!.detail).toContain('回答 2/3問');
    expect(at(sep, '2025-09-05').find((e) => e.kind === 'interview')!.detail).toContain('回答 1/3問');
    // 素材はグループで1カード（10枚を10件並べない）
    expect(at(sep, '2025-09-02').filter((e) => e.kind === 'material')).toHaveLength(1);
    expect(at(sep, '2025-09-02')[0].detail).toContain('10枚');
    expect(at(sep, '2025-09-15').find((e) => e.kind === 'scheduled')!.time).toBe('18:00');
    expect(at(sep, '2025-09-30').find((e) => e.kind === 'published')!.time).toBe('23:59');
    expect(at(sep, '2025-10-01')).toHaveLength(0);
    expect(at(oct, '2025-10-01').find((e) => e.kind === 'published')!.time).toBe('00:00');
    expect(at(oct, '2025-09-30')).toHaveLength(0);
  });

  it('13. 予定投稿を翌日に実投稿へ更新しても二重計上されず、予定日の履歴が残る', async () => {
    const a = await cast('Aさん');
    const b = await prPhotos(a.id, 1);
    const its = await items(b.batchId);
    const p = await post([its[0].id], [a.id], { platform: 'instagram', status: 'scheduled', scheduledAt: '2025-09-10T12:00' });
    await updatePost(env.db, env.admin, B, p.postIds[0], {
      category: 'self_pr', title: 'PR投稿', itemIds: [its[0].id], castIds: [a.id],
      target: { platform: 'instagram', status: 'published', publishedAt: '2025-09-11T09:00', scheduledAt: '2025-09-10T12:00' },
    });
    const evs = await calendarEvents(env.db, env.admin, B, '2025-09-01', '2025-09-30', '/s/b-club');
    const posts = evs.filter((e) => e.kind === 'scheduled' || e.kind === 'published');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ kind: 'published', date: '2025-09-11' });
    expect(posts[0].note).toContain('2025-09-10');
    expect((await listPosts(env.db, env.admin, B))).toHaveLength(1);
  });

  it('キャスト・種別・投稿先で絞り込める', async () => {
    const a = await cast('Aさん');
    const c = await cast('Cさん');
    await prPhotos(a.id, 1, { shotOn: '2025-09-02' });
    await prPhotos(c.id, 1, { shotOn: '2025-09-02' });
    await post([], [a.id], { platform: 'tiktok', status: 'published', publishedAt: '2025-09-03T10:00' });
    const only = await calendarEvents(env.db, env.admin, B, '2025-09-01', '2025-09-30', '/s/b-club', { castId: a.id });
    expect(only.every((e) => e.castIds.includes(a.id))).toBe(true);
    const ig = await calendarEvents(env.db, env.admin, B, '2025-09-01', '2025-09-30', '/s/b-club', { kinds: ['published'], platform: 'instagram' });
    expect(ig).toHaveLength(0);
  });
});

describe('14-16. 店舗共通・素材未紐付け・退店', () => {
  it('14. 店舗共通のブランド映像をキャストなしで登録・投稿でき、キャスト一覧に架空の行は出ない', async () => {
    const batch = await createMaterial(env.db, env.admin, B, { category: 'brand_video', mediaKind: 'video', quantity: 2, castIds: [], shotOn: '2025-09-01', title: 'ブランド映像' });
    const its = await items(batch.batchId);
    await createPosts(env.db, env.admin, B, { category: 'brand_video', title: 'ブランド', itemIds: [its[0].id], castIds: [], targets: [{ platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30' }] });
    expect(await castStats(env.db, env.admin, B, ALL)).toHaveLength(0);
    const ss = await storeStats(env.db, env.admin, B, ALL);
    expect(ss).toMatchObject({ used: 1, unused: 1 });
    expect(ss.posts.published).toBe(1);
    expect(ss.common).toMatchObject({ items: 2, videos: 2, publishedPosts: 1 });
  });

  it('15. 素材未紐付けの過去投稿は投稿件数だけ増え、素材使用数は増えない', async () => {
    const a = await cast('Aさん');
    await prPhotos(a.id, 3);
    await post([], [a.id], { platform: 'instagram', status: 'published', publishedAt: '2025-08-01T10:00' });
    const s = await stat(a.id);
    expect(s).toMatchObject({ published_posts: 1, used_items: 0, unused_items: 3 });
    const ss = await storeStats(env.db, env.admin, B, ALL);
    expect(ss.publishedUnlinked).toBe(1);
    expect(ss.used).toBe(0);
    expect((await listPosts(env.db, env.admin, B, { unlinkedOnly: true }))).toHaveLength(1);
  });

  it('16. 退店(非表示)にしても素材・投稿の集計は消えない', async () => {
    const a = await cast('Aさん');
    const b = await prPhotos(a.id, 2);
    const its = await items(b.batchId);
    await post([its[0].id], [a.id], { platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30' });
    await updateCast(env.db, env.admin, B, a.id, { displayName: 'Aさん', status: 'inactive' });
    expect(await stat(a.id)).toMatchObject({ status: 'inactive', total_items: 2, used_items: 1, published_posts: 1 });
    expect((await storeStats(env.db, env.admin, B, ALL)).posts.published).toBe(1);
  });
});

describe('17. 数量変更・取消', () => {
  it('投稿に使った個別素材は取り消せない。未使用は対象を明示して取り消せ、番号は振り直されない', async () => {
    const a = await cast('Aさん');
    const b = await prPhotos(a.id, 3);
    const its = await items(b.batchId);
    const p = await post([its[0].id], [a.id], { platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30' });
    await rejects(voidItems(env.db, env.admin, B, { itemIds: [its[0].id], reason: '減らす' }), 'conflict');
    await rejects(voidBatch(env.db, env.admin, B, b.batchId, '誤登録'), 'conflict');
    expect(await voidItems(env.db, env.admin, B, { itemIds: [its[1].id], reason: '不要' })).toBe(1);
    expect((await stat(a.id)).total_items).toBe(2);
    await addItems(env.db, env.admin, B, b.batchId, 2);
    const after = await items(b.batchId);
    expect(after.map((i) => i.code)).toEqual(['BCL-PR-0001-01', 'BCL-PR-0001-03', 'BCL-PR-0001-04', 'BCL-PR-0001-05']);
    expect(after[3].cast_ids).toEqual([a.id]);
    // 投稿を取り消せば素材グループも取り消せる
    await voidPost(env.db, env.admin, B, p.postIds[0], '誤登録');
    await voidBatch(env.db, env.admin, B, b.batchId, '誤登録');
    expect((await listBatches(env.db, env.admin, B))).toHaveLength(0);
  });

  it('派生素材を切り出せ、別キャストに紐付く', async () => {
    const a = await cast('Aさん');
    const c = await cast('Cさん');
    const b = await createMaterial(env.db, env.admin, B, { category: 'event_material', mediaKind: 'image', quantity: 1, castIds: [a.id, c.id], shotOn: '2025-09-01', title: '2ショット' });
    const [src] = await items(b.batchId);
    const id = await createDerivedItem(env.db, env.admin, B, { sourceItemId: src.id, castIds: [a.id] });
    const all = await items(b.batchId);
    const d = all.find((i) => i.id === id)!;
    expect(d.derived_from_item_id).toBe(src.id);
    expect(d.cast_ids).toEqual([a.id]);
  });
});

describe('19. 二重登録・入力検証', () => {
  it('同じリクエストキーの連打は1件のみ登録', async () => {
    const a = await cast('Aさん');
    const k = 'req-key-12345678';
    const r1 = await prPhotos(a.id, 5, { requestKey: k });
    const r2 = await prPhotos(a.id, 5, { requestKey: k });
    expect(r2.duplicate).toBe(true);
    expect(r2.batchId).toBe(r1.batchId);
    expect((await stat(a.id)).total_items).toBe(5);
    const pk = 'post-key-1234567';
    await Promise.all([1, 2, 3].map(() => post([], [a.id], { platform: 'instagram', status: 'draft' }, { requestKey: pk }).catch(() => null)));
    expect(await listPosts(env.db, env.admin, B)).toHaveLength(1);
  });

  it('数量は正の整数のみ（0・小数・負数・上限超過は拒否）', async () => {
    const a = await cast('Aさん');
    for (const q of [0, 1.5, -3, 501, '5' as unknown as number]) await rejects(prPhotos(a.id, q), 'validation');
    expect((await stat(a.id)).total_items).toBe(0);
  });

  it('投稿の状態・日時の検証', async () => {
    const a = await cast('Aさん');
    const e1 = await rejects(post([], [a.id], { platform: 'instagram', status: 'scheduled' }), 'validation');
    expect(e1.fields.scheduledAt).toBeTruthy();
    await rejects(post([], [a.id], { platform: 'instagram', status: 'published' }), 'validation');
    const e3 = await rejects(post([], [a.id], { platform: 'instagram', status: 'published', publishedAt: '2099-01-01T10:00' }), 'validation');
    expect(e3.message).toContain('投稿予定');
    await rejects(post([], [a.id], { platform: 'instagram', status: 'draft', url: 'ftp://example.com' }), 'validation');
    const b = await prPhotos(a.id, 1);
    const [it] = await items(b.batchId);
    await rejects(post([it.id, it.id], [a.id], { platform: 'instagram', status: 'draft' }), 'validation');
    expect(await listPosts(env.db, env.admin, B)).toHaveLength(0);
  });

  it('InstagramとTikTokへの同時登録は2レコード・同じグループIDで、状態や日時は別々', async () => {
    const a = await cast('Aさん');
    const r = await createPosts(env.db, env.admin, B, {
      category: 'self_pr', title: '同時', itemIds: [], castIds: [a.id],
      targets: [
        { platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30', url: 'https://instagram.com/p/x' },
        { platform: 'tiktok', status: 'scheduled', scheduledAt: '2099-02-01T20:00' },
      ],
    });
    expect(r.postIds).toHaveLength(2);
    const ps = await listPosts(env.db, env.admin, B);
    expect(new Set(ps.map((p) => p.post_group_id)).size).toBe(1);
    expect(ps.map((p) => p.status).sort()).toEqual(['published', 'scheduled']);
  });

  it('投稿の取消(誤登録)は集計から除外される。公開状態メモは取消とは別に保持できる', async () => {
    const a = await cast('Aさん');
    const r = await post([], [a.id], { platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30', publicStateNote: 'SNS側で削除済み' });
    expect((await stat(a.id)).published_posts).toBe(1);
    expect((await listPosts(env.db, env.admin, B))[0].public_state_note).toBe('SNS側で削除済み');
    await voidPost(env.db, env.admin, B, r.postIds[0], '誤登録');
    expect((await stat(a.id)).published_posts).toBe(0);
  });
});

describe('期間フィルター', () => {
  it('今月は日本時間の当月。素材の在庫は期間に関係なく全期間', async () => {
    const a = await cast('Aさん');
    const b = await prPhotos(a.id, 2);
    const its = await items(b.batchId);
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7);
    await post([its[0].id], [a.id], { platform: 'instagram', status: 'published', publishedAt: '2020-01-05T10:00' });
    await post([its[1].id], [a.id], { platform: 'tiktok', status: 'published', publishedAt: `${jst}-01T00:00` });
    const month = parsePeriod({ period: 'month' });
    expect((await castStats(env.db, env.admin, B, month)).find((c) => c.id === a.id)!.published_posts).toBe(1);
    expect((await castStats(env.db, env.admin, B, ALL)).find((c) => c.id === a.id)!.published_posts).toBe(2);
    expect((await storeStats(env.db, env.admin, B, month)).used).toBe(2);
    const custom = parsePeriod({ period: 'custom', from: '2020-01-01', to: '2020-01-31' });
    expect((await storeStats(env.db, env.admin, B, custom)).posts.published).toBe(1);
  });
});

describe('かんたん投稿', () => {
  it('名前・備考・ファイル数だけで素材が自動登録され、画像と動画は別グループ。連打は1回分', async () => {
    const a = await cast('Aさん');
    const key = 'quick-key-12345678';
    const r = await createQuickUpload(env.db, env.editorB, B, { requestKey: key, castId: a.id, memo: '9月分', images: 3, videos: 1 });
    expect(r.batches.map((b) => [b.kind, b.itemIds.length])).toEqual([['image', 3], ['video', 1]]);
    await createQuickUpload(env.db, env.editorB, B, { requestKey: key, castId: a.id, memo: '9月分', images: 3, videos: 1 });
    expect(await stat(a.id)).toMatchObject({ images: 3, videos: 1, total_items: 4 });
    const d = await getBatchDetail(env.db, env.admin, B, r.batches[0].batchId);
    expect(d.memo).toBe('9月分');
    expect(d.purpose).toBe('sns');
    const ad = await createQuickUpload(env.db, env.editorB, B, { castId: a.id, purpose: 'ad', images: 1 });
    expect((await getBatchDetail(env.db, env.admin, B, ad.batches[0].batchId)).purpose).toBe('ad');
    expect((await listBatches(env.db, env.admin, B, { purpose: 'ad' })).map((b) => b.id)).toEqual([ad.batches[0].batchId]);
  });
  it('キャストなし(店舗共通)でも登録でき、ファイル0件・他店舗キャスト・閲覧専用は拒否', async () => {
    const k = await cast('Kの子', K);
    await createQuickUpload(env.db, env.editorB, B, { images: 2 });
    expect((await storeStats(env.db, env.admin, B, ALL)).common.items).toBe(2);
    await rejects(createQuickUpload(env.db, env.editorB, B, { images: 0, videos: 0 }), 'validation');
    await rejects(createQuickUpload(env.db, env.editorB, B, { castId: k.id, images: 1 }), 'validation');
    await rejects(createQuickUpload(env.db, env.viewerB, B, { images: 1 }), 'forbidden');
  });
});

describe('用途', () => {
  it('用途別の集計（使用済み・未使用・投稿可能）と、インタビュー撮影への用途指定', async () => {
    const a = await cast('Aさん');
    const sns = await prPhotos(a.id, 3, { purpose: 'sns' });
    await prPhotos(a.id, 2, { purpose: 'ad' });
    await prPhotos(a.id, 1);
    const set = (await listQuestionSets(env.db))[0];
    await createInterviewShoot(env.db, env.admin, B, { shotOn: '2025-09-01', setId: set.id, castIds: [a.id], purpose: 'ad' });
    const its = await items(sns.batchId);
    await post([its[0].id], [a.id], { platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30' });
    const by = Object.fromEntries((await storeStats(env.db, env.admin, B, ALL)).byPurpose.map((p) => [p.purpose ?? 'none', p]));
    expect(by.sns).toMatchObject({ total: 3, used: 1, unused: 2, ready: 2 });
    expect(by.ad).toMatchObject({ total: 3, used: 0, unused: 3 });
    expect(by.none).toMatchObject({ total: 1 });
  });
});

describe('状態の一括変更', () => {
  it('選択した個別素材の状態をまとめて変更できる。他店舗・取消済み・閲覧専用は不可', async () => {
    const a = await cast('Aさん');
    const b = await prPhotos(a.id, 4);
    const its = await items(b.batchId);
    expect(await updateItemsStatus(env.db, env.editorB, B, { itemIds: its.slice(0, 3).map((i) => i.id), status: 'unusable' })).toBe(3);
    const after = await items(b.batchId);
    expect(after.map((i) => i.status)).toEqual(['unusable', 'unusable', 'unusable', 'ready']);
    await rejects(updateItemsStatus(env.db, env.viewerB, B, { itemIds: [its[0].id], status: 'ready' }), 'forbidden');
    await rejects(updateItemsStatus(env.db, env.admin, K, { itemIds: [its[0].id], status: 'ready' }), 'not_found');
    await rejects(updateItemsStatus(env.db, env.admin, B, { itemIds: [], status: 'ready' }), 'validation');
    await voidItems(env.db, env.admin, B, { itemIds: [its[3].id], reason: 'x' });
    await rejects(updateItemsStatus(env.db, env.admin, B, { itemIds: [its[3].id], status: 'ready' }), 'not_found');
  });
});
