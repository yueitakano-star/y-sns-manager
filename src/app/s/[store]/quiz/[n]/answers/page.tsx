import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageCtx } from '@/lib/page';
import { getQuizSet } from '@/lib/domain/quiz';
import { AppError } from '@/lib/errors';
import { quizLabel } from '@/lib/constants';
import { Badge, PageHeader, SectionTitle } from '@/components/ui';
import { CopyButton } from '@/components/CopyButton';

export default async function QuizAnswersPage({ params }: { params: Promise<{ store: string; n: string }> }) {
  const { n } = await params;
  const { db, base } = await pageCtx(params);
  const num = Number(n);
  const set = await getQuizSet(db, Number.isInteger(num) ? num : 0).catch((e) => {
    if (e instanceof AppError && e.code === 'not_found') notFound();
    throw e;
  });
  return (
    <>
      <PageHeader title={quizLabel(set.set_number, set.title)} sub="担当者用・正解" actions={<Link href={`${base}/quiz/${set.set_number}`} className="btn-sub">撮影用（問題）へ</Link>} />
      <p role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800">
        このページには正解が出ています。キャストには見せないでください（見せる時は「撮影用（問題）」を使います）。
      </p>
      <ol className="space-y-2" data-testid="quiz-answers">
        {set.questions.map((q) => (
          <li key={q.id} className="card !p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm"><b>Q{q.position}</b><Badge tone={q.position === 5 ? 'amber' : 'slate'}>{q.level}</Badge></div>
            <p className="mt-1">{q.text}</p>
            <p className="mt-1 text-xl font-bold text-emerald-800">答え：{q.answer}</p>
          </li>
        ))}
      </ol>
      <SectionTitle kind="post">投稿者コメント（そのままコピー）</SectionTitle>
      <div className="card space-y-3">
        <p className="whitespace-pre-wrap text-base leading-relaxed" data-testid="quiz-comment">{set.comment_template}</p>
        <CopyButton text={set.comment_template} label="コメントをコピー" />
        <p className="text-xs text-slate-500">投稿後、このコメントを実際に掲載してください（固定できる場合は固定）。</p>
      </div>
      {set.memo ? (<><SectionTitle>出題・判定メモ</SectionTitle><p className="card text-sm">{set.memo}</p></>) : null}
      {set.reference ? (<><SectionTitle>第5問の参考／検算</SectionTitle><p className="card text-sm">{set.reference}</p></>) : null}
    </>
  );
}
