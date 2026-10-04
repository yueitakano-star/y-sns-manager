import Link from 'next/link';
import { pageCtx } from '@/lib/page';
import { listQuizSets, quizUsage } from '@/lib/domain/quiz';
import { QUIZ_SET_COUNT, quizLabel } from '@/lib/constants';
import { jstDate } from '@/lib/jst';
import { Badge, LinkBtn, PageHeader, SectionTitle } from '@/components/ui';

export default async function QuizPage({ params }: { params: Promise<{ store: string }> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  const [sets, usage] = await Promise.all([listQuizSets(db), quizUsage(db, user, store.id)]);
  const use = new Map(usage.map((u) => [u.quiz_set_id, u]));
  const posted = usage.filter((u) => u.published > 0).length;
  return (
    <>
      <PageHeader
        title="クイズ集"
        sub={`一般常識クイズ 全${sets.length}セット × 5問（${store.name}の投稿状況）`}
        actions={editable ? <LinkBtn href={`${base}/posts/new?category=quiz`} kind="post">＋ クイズの投稿登録</LinkBtn> : null}
      />
      <div className="card mb-3 text-sm">
        <p>Q1〜3は基本、Q4は少し難しく、<b>Q5は超難問で、答えは動画では言わずコメント欄へ</b>。キャストに見せる時は「撮影用」を開き、正解のある「担当者用」は見せないでください。</p>
        <p className="mt-1 text-slate-600">投稿済みセット: <b>{posted}</b> / {QUIZ_SET_COUNT}（投稿登録で系統「クイズ」を選ぶと、ここに反映されます）</p>
      </div>
      <SectionTitle>セット一覧</SectionTitle>
      <ul className="grid gap-2 md:grid-cols-2" data-testid="quiz-sets">
        {sets.map((s) => {
          const u = use.get(s.id);
          return (
            <li key={s.id} className="card !p-3">
              <h3 className="font-bold">{quizLabel(s.set_number, s.title)}</h3>
              <div className="mt-1 flex flex-wrap gap-1">
                {u?.published ? <Badge tone="post">投稿済み {u.published}回</Badge> : <Badge>未投稿</Badge>}
                {u?.scheduled ? <Badge tone="blue">投稿予定 {u.scheduled}件</Badge> : null}
                {u?.last_published ? <Badge>最終 {jstDate(u.last_published)}</Badge> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`${base}/quiz/${s.set_number}`} className="btn-mat">撮影用（問題）</Link>
                <Link href={`${base}/quiz/${s.set_number}/answers`} className="btn-sub">担当者用（正解）</Link>
                {editable ? <Link href={`${base}/posts/new?category=quiz&quiz=${s.id}`} className="btn-sub">投稿登録</Link> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
