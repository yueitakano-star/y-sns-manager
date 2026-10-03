import Link from 'next/link';
import { pageCtx, one, type SP } from '@/lib/page';
import { castStats, storeStats } from '@/lib/domain/stats';
import { CATEGORY_BY_KEY, PLATFORM_LABEL, QUESTION_COUNT, SET_COUNT, type CategoryKey, type Platform } from '@/lib/constants';
import { parsePeriod, periodLabel } from '@/lib/jst';
import { PageHeader, SectionTitle, Stat, LinkBtn, fmtNum } from '@/components/ui';
import { PeriodFilter } from '@/components/PeriodFilter';
import { QuickUpload } from '@/components/QuickUpload';
import { supabaseStorage } from '@/lib/storage';
import { CastStatsList, applyCastParams } from '@/components/CastStatsList';

export default async function Dashboard({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  const sp = await searchParams;
  const period = parsePeriod({ period: one(sp.period), from: one(sp.from), to: one(sp.to) });
  const [stats, casts] = await Promise.all([storeStats(db, user, store.id, period), castStats(db, user, store.id, period)]);
  const activeCasts = casts.filter((c) => c.status === 'active');
  const plabel = periodLabel(period);

  return (
    <>
      <PageHeader
        title={`${store.name} ダッシュボード`}
        actions={
          editable ? (
            <>
              <LinkBtn href={`${base}/materials/new`} kind="mat">＋ 素材登録</LinkBtn>
              <LinkBtn href={`${base}/posts/new`} kind="post">＋ 投稿登録</LinkBtn>
            </>
          ) : null
        }
      />

      {editable ? <QuickUpload storeKey={store.key} base={base} casts={activeCasts.map((c) => ({ id: c.id, name: c.display_name }))} storageReady={supabaseStorage.configured()} /> : null}

      {casts.length === 0 ? (
        <div className="card mb-4 border-amber-300 bg-amber-50 text-sm">
          まだキャストが登録されていません。素材や投稿をキャストごとに記録するには、先にキャストを登録してください。
          {editable ? <div className="mt-2"><LinkBtn href={`${base}/casts/new`} kind="primary">キャストを登録する</LinkBtn></div> : null}
        </div>
      ) : null}

      <PeriodFilter period={period} />

      <SectionTitle kind="mat" right={<span className="text-xs font-normal">現在の在庫（全期間）</span>}>素材</SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="material-stats">
        <Stat kind="mat" label="素材総数" value={fmtNum(stats.items.total)} sub={`画像${stats.items.images}枚・動画${stats.items.videos}本・その他${stats.items.others}点`} />
        <Stat kind="mat" label="使用済み素材" value={fmtNum(stats.used)} sub="投稿済みに1回でも使用（重複なし）" />
        <Stat kind="mat" label="未使用素材" value={fmtNum(stats.unused)} sub="NG素材を含む" />
        <Stat kind="mat" label="未使用・投稿可能" value={fmtNum(stats.unusedReady)} sub="作業状態が「投稿可能」" />
        <Stat kind="mat" label="予定に割当済み（未使用）" value={fmtNum(stats.scheduledAssigned)} sub="投稿予定に紐付く未使用素材" />
      </div>
      {stats.byCategory.length ? (
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">種類別内訳</th><th className="th text-right">画像</th><th className="th text-right">動画</th><th className="th text-right">その他</th><th className="th text-right">計</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {stats.byCategory.map((c) => (
                <tr key={c.category}>
                  <td className="td">{CATEGORY_BY_KEY[c.category as CategoryKey]?.name ?? c.category}</td>
                  <td className="td text-right tabular-nums">{c.images}</td><td className="td text-right tabular-nums">{c.videos}</td>
                  <td className="td text-right tabular-nums">{c.others}</td><td className="td text-right font-semibold tabular-nums">{c.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <SectionTitle kind="post" right={<span className="text-xs font-normal">期間: {plabel}</span>}>投稿</SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="post-stats">
        <Stat kind="post" label="投稿済み件数" value={fmtNum(stats.posts.published)} sub="SNSごとに1件（Instagram+TikTok=2件）" />
        <Stat kind="post" label="投稿予定" value={fmtNum(stats.posts.scheduled)} />
        <Stat kind="post" label="下書き" value={fmtNum(stats.posts.draft)} sub="期間に関係なく全件" />
        <Stat kind="post" label="中止" value={fmtNum(stats.posts.cancelled)} sub="期間に関係なく全件" />
        <Stat kind="post" label="素材未紐付けの投稿済み" value={fmtNum(stats.publishedUnlinked)} sub="素材使用数には含めません" />
      </div>
      {stats.publishedByPlatform.length ? (
        <p className="mt-2 text-sm text-slate-600">
          投稿先別（投稿済み）：{stats.publishedByPlatform.map((p) => `${PLATFORM_LABEL[p.platform as Platform] ?? p.platform} ${p.n}件`).join(' ／ ')}
        </p>
      ) : null}

      <SectionTitle right={<span className="text-xs font-normal">現在の全期間</span>}>インタビュー回答の進捗</SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label={`完了セット（延べ・各キャスト/${SET_COUNT}）`} value={fmtNum(stats.interview.doneSetsTotal)} sub="同じセットの3問すべて回答済み" />
        <Stat label={`回答した異なる質問（延べ・各キャスト/${QUESTION_COUNT}）`} value={fmtNum(stats.interview.answeredQuestionsTotal)} sub="再撮影で答えても増えません" />
        <Stat label="在籍キャスト" value={fmtNum(stats.castCount.active)} sub={`非表示・退店 ${stats.castCount.inactive}`} />
        <div className="flex items-center"><Link className="btn-sub w-full" href={`${base}/questions`}>キャスト×セット進捗を見る</Link></div>
      </div>

      <SectionTitle right={<Link href={`${base}/casts`} className="text-xs font-semibold underline">絞り込み・並べ替え</Link>}>キャスト別一覧</SectionTitle>
      <CastStatsList
        rows={applyCastParams(activeCasts, {})}
        base={base}
        common={stats.common}
        emptyAction={editable ? <LinkBtn href={`${base}/casts/new`} kind="primary">キャストを登録する</LinkBtn> : undefined}
      />

      <SectionTitle>CSV出力</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <a className="btn-sub" href={`${base}/export/casts`}>キャスト一覧</a>
        <a className="btn-sub" href={`${base}/export/materials`}>素材一覧</a>
        <a className="btn-sub" href={`${base}/export/posts`}>投稿履歴</a>
      </div>
    </>
  );
}
