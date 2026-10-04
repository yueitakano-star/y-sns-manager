import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedMaster } from '../src/lib/db';
import { createCast } from '../src/lib/domain/casts';
import { createPosts, getPost, listPosts, updatePost } from '../src/lib/domain/posts';
import { getQuizSet, listQuizSets, quizUsage } from '../src/lib/domain/quiz';
import { AppError } from '../src/lib/errors';
import { setupEnv, type Env } from './helpers';

let env: Env;
let B: string;
beforeAll(async () => { env = await setupEnv(); B = env.stores['b-club']; });
afterAll(async () => { await env.db.close(); });

const count = async (t: string) => (await env.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))[0].n;

describe('クイズ集', () => {
  it('20セット100問が入り、再投入しても倍増しない。各セットは5問で正解つき', async () => {
    expect(await count('quiz_sets')).toBe(20);
    expect(await count('quiz_questions')).toBe(100);
    await seedMaster(env.db);
    await seedMaster(env.db);
    expect(await count('quiz_sets')).toBe(20);
    expect(await count('quiz_questions')).toBe(100);
    const sets = await listQuizSets(env.db);
    expect(sets).toHaveLength(20);
    for (const s of sets) {
      expect(s.questions).toHaveLength(5);
      expect(s.questions.every((q) => q.text && q.answer)).toBe(true);
      expect(s.comment_template).toContain('第5問の正解は');
    }
    const s1 = await getQuizSet(env.db, 1);
    expect(s1.title).toBe('日本地理');
    expect(s1.questions[4]).toMatchObject({ level: '超難問', answer: '奈良県' });
    await expect(getQuizSet(env.db, 21)).rejects.toBeInstanceOf(AppError);
  });

  it('投稿の系統「クイズ」にセットを紐付けて登録でき、店舗ごとの投稿状況に反映される', async () => {
    const a = await createCast(env.db, env.admin, B, { displayName: 'Aさん' });
    const z = (await getQuizSet(env.db, 3)).id;
    const r = await createPosts(env.db, env.admin, B, {
      category: 'quiz', quizSetId: z, title: 'クイズ03', itemIds: [], castIds: [a.id],
      targets: [{ platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30' }, { platform: 'tiktok', status: 'scheduled', scheduledAt: '2099-01-01T12:00' }],
    });
    expect((await getPost(env.db, env.admin, B, r.postIds[0])).quiz_label).toBe('QUIZ 03｜読めそうで読めない漢字');
    expect(await quizUsage(env.db, env.admin, B)).toEqual([{ quiz_set_id: z, published: 1, scheduled: 1, last_published: expect.any(String) }]);
    // 他店舗の投稿状況には出ない
    expect(await quizUsage(env.db, env.admin, env.stores['kingyo'])).toEqual([]);
    // 系統を変えるとセット紐付けは外れる
    await updatePost(env.db, env.admin, B, r.postIds[0], { category: 'daily_photo', title: 'x', itemIds: [], castIds: [a.id], target: { platform: 'instagram', status: 'published', publishedAt: '2025-09-10T19:30' } });
    expect((await listPosts(env.db, env.admin, B)).find((p) => p.id === r.postIds[0])!.quiz_set_id).toBeNull();
  });

  it('存在しないクイズセットは拒否', async () => {
    await expect(createPosts(env.db, env.admin, B, {
      category: 'quiz', quizSetId: '00000000-0000-4000-8000-000000000000', title: 'x', targets: [{ platform: 'instagram', status: 'draft' }],
    })).rejects.toMatchObject({ code: 'validation' });
  });
});
