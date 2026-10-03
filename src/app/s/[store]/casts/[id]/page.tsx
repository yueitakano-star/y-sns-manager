import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageCtx, one, type SP } from '@/lib/page';
import { getCast } from '@/lib/domain/casts';
import { answerHistory, castStats, listQuestionSets, questionProgress } from '@/lib/domain/stats';
import { listBatches } from '@/lib/domain/materials';
import { listPosts } from '@/lib/domain/posts';
import { AppError } from '@/lib/errors';
import { ANSWER_LABEL, QUESTION_COUNT, SET_COUNT, setLabel } from '@/lib/constants';
import { parsePeriod } from '@/lib/jst';
import { Badge, Empty, LinkBtn, PageHeader, SectionTitle, SetBadge, Stat } from '@/components/ui';
import { BatchList, PostList } from '@/components/lists';

export default async function CastDetail({ params, searchParams }: { params: Promise<{ store: string; id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, user, store, base, editable } = await pageCtx(params);
  const cast = await getCast(db, user, store.id, id).catch((e) => {
    if (e instanceof AppError && e.code === 'not_found') notFound();
    throw e;
  });
  const all = parsePeriod({});
  const [rows, progress, sets, history, batches, posts] = await Promise.all([
    castStats(db, user, store.id, all),
    questionProgress(db, user, store.id, id),
    listQuestionSets(db),
    answerHistory(db, user, store.id, id),
    listBatches(db, user, store.id, { castId: id }),
    listPosts(db, user, store.id, { castId: id }),
  ]);
  const s = rows.find((r) => r.id === id)!;
  const cells = progress[id] ?? {};
  const setFilter = Number(one(sp.set)) || null;
  const shownHistory = setFilter ? history.filter((h) => h.set_number === setFilter) : history;
  const published = posts.filter((p) => p.status === 'published');
  const scheduled = posts.filter((p) => p.status === 'scheduled');
  const lastShotSet = history.at(-1);
  void lastShotSet;

  return (
    <>
      <PageHeader
        title={<>{cast.display_name} {cast.status === 'inactive' ? <Badge>非表示・退店</Badge> : null}</>}
        sub={`${store.name}${cast.furigana ? `・${cast.furigana}` : ''}`}
        actions={
          editable ? (
            <>
              <LinkBtn href={`${base}/materials/new?cast=${id}`} kind="mat">＋ 素材登録</LinkBtn>
              <LinkBtn href={`${base}/posts/new?cast=${id}`} kind="post">＋ 投稿登録</LinkBtn>
              <LinkBtn href={`${base}/casts/${id}/edit`}>編集</LinkBtn>
            </>
          ) : null
        }
      />
      {cast.memo ? <p className="card mb-3 whitespace-pre-wrap text-sm">{cast.memo}</p> : null}

      <SectionTitle kind="mat" right={<span className="text-xs font-normal">現在の全期間</span>}>素材</SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="cast-material-stats">
        <Stat kind="mat" label="素材" value={`${s.total_items}点`} sub={`画像${s.images}枚／動画${s.videos}本／その他${s.others}点`} />
        <Stat kind="mat" label="投稿使用済みの素材" value={`${s.used_items}点`} sub={`画像${s.used_images}枚／動画${s.used_videos}本／その他${s.used_others}点`} />
        <Stat kind="mat" label="未使用素材" value={`${s.unused_items}点`} sub={`うち投稿可能 ${s.unused_ready}点`} />
        <Stat kind="mat" label="予定に割当済み" value={`${s.scheduled_items}点`} sub="投稿予定に紐付く素材" />
      </div>

      <SectionTitle kind="post">投稿</SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat kind="post" label="投稿済み件数" value={`${published.length}件`} sub={`最終投稿日 ${s.last_published ? s.last_published.slice(0, 10) : '—'}`} />
        <Stat kind="post" label="投稿予定件数" value={`${scheduled.length}件`} />
        <Stat label="最終撮影日" value={<span className="text-lg">{s.last_shot ?? '—'}</span>} />
        <Stat label="撮影回数" value={`${s.takes}回`} sub="再撮影を含む" />
      </div>

      <SectionTitle right={<span className="text-xs font-normal">現在の全期間</span>}>インタビュー回答の進捗</SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label={`完了した質問セット / ${SET_COUNT}`} value={s.done_sets} sub="同じセットの3問が回答済み（撮影が分かれてもOK）" />
        <Stat label={`回答した異なる質問 / ${QUESTION_COUNT}`} value={s.answered_questions} sub="再撮影で答えても増えません" />
        <Stat label="撮影回数（再撮影含む）" value={s.takes} />
        <Stat label="投稿済みインタビューセット" value={s.posted_interview_sets} sub="回答進捗とは別に集計" />
      </div>

      <h3 className="mb-2 mt-4 text-sm font-bold">質問セット {SET_COUNT}個の実施状況（押すと該当履歴を表示）</h3>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="set-grid">
        {sets.map((st) => {
          const c = cells[st.set_number];
          return (
            <li key={st.id}>
              <Link href={`?set=${st.set_number}#history`} className={`block h-full rounded-lg border p-2 text-xs hover:border-slate-800 ${setFilter === st.set_number ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                <div className="font-bold">{setLabel(st.set_number, st.title)}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <SetBadge state={c?.state ?? 'none'} />
                  {c && c.answered > 0 ? <Badge>{c.answered}/3問</Badge> : null}
                  {c && c.passed > 0 ? <Badge tone="amber">パス{c.passed}</Badge> : null}
                  {c?.posted ? <Badge tone="post">投稿済み</Badge> : null}
                  {c && c.takes > 0 ? <Badge>撮影{c.takes}回</Badge> : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <SectionTitle kind="mat" right={<span>{batches.length}件</span>}>素材一覧</SectionTitle>
      {batches.length ? <BatchList rows={batches} base={base} /> : <Empty>このキャストの素材はまだありません。</Empty>}

      <div id="history" />
      <SectionTitle right={setFilter ? <Link href="?" className="underline">全セットを表示</Link> : undefined}>
        回答履歴{setFilter ? `（SET ${String(setFilter).padStart(2, '0')} のみ）` : ''}
      </SectionTitle>
      {shownHistory.length ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">セット</th><th className="th">質問</th><th className="th">状態</th><th className="th">回答日</th><th className="th">撮影日（回）</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {shownHistory.map((h) => (
                <tr key={h.id}>
                  <td className="td whitespace-nowrap">{setLabel(h.set_number, h.set_title)}</td>
                  <td className="td">Q{h.position}. {h.question_text}</td>
                  <td className="td"><Badge tone={h.status === 'answered' ? 'green' : h.status === 'passed' ? 'amber' : 'slate'}>{ANSWER_LABEL[h.status]}</Badge></td>
                  <td className="td whitespace-nowrap">{h.answered_on ?? '—'}</td>
                  <td className="td whitespace-nowrap">
                    {h.batch_id ? <Link className="underline" href={`${base}/materials/${h.batch_id}`}>{h.shot_on}（{h.take_no}回目）</Link> : `${h.shot_on}（${h.take_no}回目）`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>回答履歴はありません。</Empty>
      )}

      <SectionTitle kind="post" right={<span>{posts.length}件</span>}>投稿履歴</SectionTitle>
      {posts.length ? <PostList rows={posts} base={base} /> : <Empty>このキャストが出演する投稿はまだありません。</Empty>}
    </>
  );
}
