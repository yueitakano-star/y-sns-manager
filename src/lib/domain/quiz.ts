import type { Queryable } from '../db';
import type { Actor } from '../access';
import { requireRole } from '../access';
import { notFound } from '../errors';

export interface QuizQuestion {
  id: string;
  position: number;
  level: string;
  text: string;
  answer: string;
}
export interface QuizSet {
  id: string;
  set_number: number;
  title: string;
  comment_template: string;
  memo: string | null;
  reference: string | null;
  questions: QuizQuestion[];
}

/** クイズ集（全店舗共通のマスター）。正解を含むので、表示は撮影用ページと担当者用ページで分ける */
export async function listQuizSets(q: Queryable): Promise<QuizSet[]> {
  const sets = await q.query<Omit<QuizSet, 'questions'>>(
    `SELECT id, set_number, title, comment_template, memo, reference FROM quiz_sets
      WHERE version = (SELECT max(version) FROM quiz_sets x WHERE x.set_number = quiz_sets.set_number) ORDER BY set_number`,
  );
  const qs = await q.query<QuizQuestion & { quiz_set_id: string }>(
    'SELECT id, quiz_set_id, position, level, text, answer FROM quiz_questions ORDER BY position',
  );
  return sets.map((s) => ({ ...s, questions: qs.filter((x) => x.quiz_set_id === s.id).map(({ quiz_set_id: _drop, ...r }) => r) }));
}

export async function getQuizSet(q: Queryable, setNumber: number): Promise<QuizSet> {
  const s = (await listQuizSets(q)).find((x) => x.set_number === setNumber);
  if (!s) throw notFound('クイズセット');
  return s;
}

export interface QuizUsage {
  quiz_set_id: string;
  published: number;
  scheduled: number;
  last_published: string | null;
}

/** 店舗ごとの、クイズセットの投稿状況（投稿済み件数・投稿予定件数・最終投稿日時） */
export async function quizUsage(q: Queryable, actor: Actor, storeId: string): Promise<QuizUsage[]> {
  await requireRole(q, actor, storeId, 'viewer');
  return q.query<QuizUsage>(
    `SELECT quiz_set_id,
            count(*) FILTER (WHERE status='published')::int AS published,
            count(*) FILTER (WHERE status='scheduled')::int AS scheduled,
            max(published_at) FILTER (WHERE status='published') AS last_published
       FROM posts WHERE store_id=$1 AND voided_at IS NULL AND quiz_set_id IS NOT NULL GROUP BY quiz_set_id`,
    [storeId],
  );
}
