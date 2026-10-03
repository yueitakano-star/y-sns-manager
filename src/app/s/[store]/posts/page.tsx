import { pageCtx, one, type SP } from '@/lib/page';
import { listPosts } from '@/lib/domain/posts';
import { listCasts } from '@/lib/domain/casts';
import { PLATFORMS, POST_CATEGORIES, POST_STATES } from '@/lib/constants';
import { parsePeriod } from '@/lib/jst';
import { Empty, LinkBtn, PageHeader, SectionTitle, SelectField } from '@/components/ui';
import { PostList } from '@/components/lists';
import { PeriodFilter } from '@/components/PeriodFilter';

export default async function PostsPage({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  const sp = await searchParams;
  const period = parsePeriod({ period: one(sp.period), from: one(sp.from), to: one(sp.to) });
  const f = { status: one(sp.status), platform: one(sp.platform), category: one(sp.category), castId: one(sp.cast) };
  const casts = await listCasts(db, user, store.id);
  const rows = await listPosts(db, user, store.id, {
    ...f,
    from: period.kind === 'all' ? undefined : period.from,
    to: period.kind === 'all' ? undefined : period.to,
    unlinkedOnly: one(sp.unlinked) === '1',
  });
  return (
    <>
      <PageHeader kind="post" title="投稿" sub={`${store.name}・SNSに投稿した（する）記録`} actions={editable ? <LinkBtn href={`${base}/posts/new`} kind="post">＋ 投稿登録</LinkBtn> : null} />
      <PeriodFilter period={period} hidden={{ status: f.status, platform: f.platform, category: f.category, cast: f.castId }} />
      <form method="get" className="card mb-3 flex flex-wrap items-end gap-3" aria-label="投稿の絞り込み">
        {period.kind !== 'all' ? <input type="hidden" name="period" value={period.kind} /> : null}
        {period.kind === 'custom' ? (<><input type="hidden" name="from" value={period.fromDate} /><input type="hidden" name="to" value={period.toDate} /></>) : null}
        <SelectField name="status" label="状態" value={f.status} options={POST_STATES.map((s) => ({ value: s.key, label: s.name }))} />
        <SelectField name="platform" label="投稿先" value={f.platform} options={PLATFORMS.map((p) => ({ value: p.key, label: p.name }))} />
        <SelectField name="category" label="系統" value={f.category} options={POST_CATEGORIES.map((c) => ({ value: c.key, label: c.name }))} />
        <SelectField name="cast" label="キャスト" value={f.castId} options={casts.map((c) => ({ value: c.id, label: c.display_name }))} />
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="unlinked" value="1" defaultChecked={one(sp.unlinked) === '1'} className="size-5" />素材未紐付けのみ</label>
        <button className="btn-primary" type="submit">絞り込む</button>
      </form>
      <SectionTitle kind="post" right={<span>{rows.length}件</span>}>投稿一覧</SectionTitle>
      {rows.length ? <PostList rows={rows} base={base} /> : <Empty action={editable ? <LinkBtn href={`${base}/posts/new`} kind="post">＋ 投稿登録</LinkBtn> : undefined}>該当する投稿はありません。</Empty>}
    </>
  );
}
