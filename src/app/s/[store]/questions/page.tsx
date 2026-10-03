import Link from 'next/link';
import { pageCtx, one, type SP } from '@/lib/page';
import { listCasts } from '@/lib/domain/casts';
import { listQuestionSets, questionProgress, type SetCell } from '@/lib/domain/stats';
import { setLabel } from '@/lib/constants';
import { Badge, Empty, LinkBtn, PageHeader, SectionTitle, SetBadge } from '@/components/ui';

function Cell({ c }: { c?: SetCell }) {
  const state = c?.state ?? 'none';
  const tone = { none: 'bg-white text-slate-400', noanswer: 'bg-amber-50 text-amber-800', partial: 'bg-sky-50 text-sky-800', done: 'bg-emerald-50 text-emerald-800' }[state];
  const mark = { none: '—', noanswer: '○0', partial: `${c?.answered}/3`, done: '✓3' }[state];
  return (
    <span className={`flex min-h-10 flex-col items-center justify-center rounded text-xs font-bold ${tone}`} title={c ? `回答${c.answered}問・パス${c.passed}・撮影${c.takes}回` : '未実施'}>
      {mark}
      {c?.posted ? <span className="text-[10px] text-post-700">投稿済</span> : null}
    </span>
  );
}

export default async function QuestionsPage({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  const sp = await searchParams;
  const [sets, casts, progress] = await Promise.all([listQuestionSets(db), listCasts(db, user, store.id), questionProgress(db, user, store.id)]);
  const active = casts.filter((c) => c.status === 'active');
  const shown = casts.filter((c) => c.status === 'active' || progress[c.id]);
  const pick = one(sp.cast) && shown.some((c) => c.id === one(sp.cast)) ? (one(sp.cast) as string) : shown[0]?.id;

  return (
    <>
      <PageHeader title="質問集" sub={`インタビュー質問 全${sets.length}セット・各3問（${store.name}の進捗）`} actions={editable ? <LinkBtn href={`${base}/materials/new?category=interview`} kind="mat">＋ インタビュー撮影を登録</LinkBtn> : null} />

      <SectionTitle>キャスト別の進捗</SectionTitle>
      {shown.length === 0 ? (
        <Empty action={editable ? <LinkBtn href={`${base}/casts/new`} kind="primary">キャストを登録する</LinkBtn> : undefined}>キャストが登録されていません。</Empty>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-600">
            セルの見方: <b>—</b> 未実施 ／ <b>○0</b> 実施・回答なし ／ <b>n/3</b> 一部回答 ／ <b>✓3</b> 3問完了。「投稿済」は回答進捗とは別に、そのセットのインタビュー素材が投稿済みであることを示します。パスは回答済みに数えません。
          </p>
          {/* PC: キャスト×SET 01〜20 */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block" data-testid="progress-matrix">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th sticky left-0 bg-slate-50">キャスト</th>
                  {sets.map((s) => (<th key={s.id} className="th text-center" title={setLabel(s.set_number, s.title)}>{String(s.set_number).padStart(2, '0')}</th>))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td className="td sticky left-0 whitespace-nowrap bg-white font-semibold"><Link className="underline" href={`${base}/casts/${c.id}`}>{c.display_name}</Link></td>
                    {sets.map((s) => (
                      <td key={s.id} className="p-0.5">
                        <Link href={`${base}/casts/${c.id}?set=${s.set_number}#history`} aria-label={`${c.display_name} ${setLabel(s.set_number, s.title)}`}><Cell c={progress[c.id]?.[s.set_number]} /></Link>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* スマホ: キャストを選んで20セットを縦リスト */}
          <div className="md:hidden">
            <form method="get" className="mb-2">
              <label className="label" htmlFor="cast-pick">キャストを選択</label>
              <select id="cast-pick" name="cast" className="input" defaultValue={pick}>
                {shown.map((c) => (<option key={c.id} value={c.id}>{c.display_name}</option>))}
              </select>
              <button type="submit" className="btn-primary mt-2 w-full">表示</button>
            </form>
            <ul className="space-y-2" data-testid="progress-list">
              {sets.map((s) => {
                const c = pick ? progress[pick]?.[s.set_number] : undefined;
                return (
                  <li key={s.id} className="card !p-3">
                    <div className="font-bold">{setLabel(s.set_number, s.title)}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <SetBadge state={c?.state ?? 'none'} />
                      {c && c.answered > 0 ? <Badge>{c.answered}/3問</Badge> : null}
                      {c && c.passed > 0 ? <Badge tone="amber">パス{c.passed}</Badge> : null}
                      {c?.posted ? <Badge tone="post">投稿済み</Badge> : null}
                      {c && c.takes > 0 ? <Badge>撮影{c.takes}回</Badge> : null}
                    </div>
                    {pick && c ? <Link className="mt-1 inline-block text-sm underline" href={`${base}/casts/${pick}?set=${s.set_number}#history`}>履歴を見る</Link> : null}
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="mt-2 text-xs text-slate-500">在籍キャスト {active.length}人 ／ 完了セット数は各キャスト最大{sets.length}</p>
        </>
      )}

      <SectionTitle>質問セット一覧（全{sets.length}セット）</SectionTitle>
      <ul className="grid gap-2 md:grid-cols-2" data-testid="question-sets">
        {sets.map((s) => (
          <li key={s.id} className="card !p-3">
            <h3 className="font-bold">{setLabel(s.set_number, s.title)}</h3>
            <ol className="mt-1 space-y-1">
              {s.questions.map((q) => (<li key={q.id} className="text-lg leading-snug">Q{q.position}. {q.text}</li>))}
            </ol>
          </li>
        ))}
      </ul>
    </>
  );
}
