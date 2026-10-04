import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageCtx } from '@/lib/page';
import { getQuizSet } from '@/lib/domain/quiz';
import { AppError } from '@/lib/errors';
import { QUIZ_SET_COUNT, quizLabel } from '@/lib/constants';
import { Badge, PageHeader } from '@/components/ui';

export default async function QuizSetPage({ params }: { params: Promise<{ store: string; n: string }> }) {
  const { n } = await params;
  const { db, store, base, editable } = await pageCtx(params);
  const num = Number(n);
  const set = await getQuizSet(db, Number.isInteger(num) ? num : 0).catch((e) => {
    if (e instanceof AppError && e.code === 'not_found') notFound();
    throw e;
  });
  return (
    <>
      <PageHeader title={quizLabel(set.set_number, set.title)} sub="撮影用・問題のみ（正解は表示しません）" actions={
        <>
          <Link href={`${base}/quiz/${set.set_number}/answers`} className="btn-sub">担当者用（正解）</Link>
          {editable ? <Link href={`${base}/posts/new?category=quiz&quiz=${set.id}`} className="btn-post">このセットで投稿登録</Link> : null}
        </>
      } />
      <ol className="space-y-3" data-testid="quiz-questions">
        {set.questions.map((q) => (
          <li key={q.id} className={`rounded-2xl border-2 p-4 ${q.position === 5 ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold">Q{q.position}</span>
              <Badge tone={q.position === 5 ? 'amber' : q.position === 4 ? 'blue' : 'slate'}>{q.level}</Badge>
              {q.position === 5 ? <Badge tone="amber">答えはコメント欄</Badge> : null}
            </div>
            <p className="text-2xl font-bold leading-snug sm:text-3xl">{q.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-center text-lg font-bold">最後の答えはコメント欄！ タップして答え合わせしてね。</p>
      <div className="card mt-4 text-sm">
        <p className="font-bold">50秒の構成例</p>
        <p>導入3秒 ＋ Q1〜3 各6秒 ＋ Q4 10秒 ＋ Q5 15秒 ＋ 締め4秒。長考部分は編集します。動画ではQ5の正解を確定させず、答え合わせをコメント欄につなげます。</p>
      </div>
      <nav className="mt-4 flex justify-between gap-2" aria-label="前後のセット">
        {set.set_number > 1 ? <Link className="btn-sub" href={`${base}/quiz/${set.set_number - 1}`}>‹ 前のセット</Link> : <span />}
        <Link className="btn-sub" href={`${base}/quiz`}>一覧へ</Link>
        {set.set_number < QUIZ_SET_COUNT ? <Link className="btn-sub" href={`${base}/quiz/${set.set_number + 1}`}>次のセット ›</Link> : <span />}
      </nav>
      <span hidden>{store.key}</span>
    </>
  );
}
