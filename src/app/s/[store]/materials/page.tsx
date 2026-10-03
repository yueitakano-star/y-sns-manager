import Link from 'next/link';
import { pageCtx, one, type SP } from '@/lib/page';
import { listBatches, listPickerItems } from '@/lib/domain/materials';
import { listCasts } from '@/lib/domain/casts';
import { CATEGORIES, MATERIAL_STATES } from '@/lib/constants';
import { Empty, LinkBtn, PageHeader, SectionTitle, SelectField } from '@/components/ui';
import { BatchList, ItemSelectList } from '@/components/lists';

export default async function MaterialsPage({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  const sp = await searchParams;
  const view = one(sp.view) === 'items' ? 'items' : 'batches';
  const f = { category: one(sp.category), castId: one(sp.cast), status: one(sp.status), usage: (one(sp.usage) as 'all' | 'unused' | 'used' | undefined) ?? 'all', common: one(sp.cast) === 'common' };
  const casts = await listCasts(db, user, store.id);
  const castFilter = f.common ? undefined : f.castId;
  const filterForm = (
    <form method="get" className="card mb-3 flex flex-wrap items-end gap-3" aria-label="素材の絞り込み">
      <input type="hidden" name="view" value={view} />
      <SelectField name="category" label="種類" value={f.category} options={CATEGORIES.map((c) => ({ value: c.key, label: c.name }))} />
      <SelectField name="cast" label="キャスト" value={one(sp.cast)} options={[{ value: 'common', label: '店舗共通（キャストなし）' }, ...casts.map((c) => ({ value: c.id, label: c.display_name + (c.status === 'inactive' ? '（退店）' : '') }))]} />
      <SelectField name="status" label="作業状態" value={f.status} options={MATERIAL_STATES.map((s) => ({ value: s.key, label: s.name }))} />
      <SelectField name="usage" label="使用状況" value={f.usage === 'all' ? '' : f.usage} options={[{ value: 'unused', label: '未使用あり' }, { value: 'used', label: '投稿に使用済み' }]} />
      <button className="btn-primary" type="submit">絞り込む</button>
    </form>
  );

  const tabs = (
    <div className="mb-3 flex gap-2" role="tablist">
      <Link role="tab" aria-selected={view === 'batches'} href="?view=batches" className={view === 'batches' ? 'btn-primary' : 'btn-sub'}>グループ別</Link>
      <Link role="tab" aria-selected={view === 'items'} href="?view=items&usage=unused" className={view === 'items' ? 'btn-primary' : 'btn-sub'}>個別素材（未使用から選ぶ）</Link>
    </div>
  );

  let body: React.ReactNode;
  let count = 0;
  if (view === 'batches') {
    const rows = await listBatches(db, user, store.id, { category: f.category, castId: castFilter, status: f.status, usage: f.usage, common: f.common });
    count = rows.length;
    body = rows.length ? <BatchList rows={rows} base={base} /> : (
      <Empty action={editable ? <LinkBtn href={`${base}/materials/new`} kind="mat">＋ 素材登録</LinkBtn> : undefined}>該当する素材はありません。</Empty>
    );
  } else {
    let items = await listPickerItems(db, user, store.id);
    if (f.category) items = items.filter((i) => i.category === f.category);
    if (f.status) items = items.filter((i) => i.status === f.status);
    if (f.common) items = items.filter((i) => i.cast_ids.length === 0);
    else if (f.castId) items = items.filter((i) => i.cast_ids.includes(f.castId as string));
    if (f.usage === 'unused') items = items.filter((i) => i.published_count === 0);
    if (f.usage === 'used') items = items.filter((i) => i.published_count > 0);
    count = items.length;
    body = items.length ? <ItemSelectList items={items.slice(0, 300)} castNames action={`${base}/posts/new`} /> : <Empty>該当する個別素材はありません。</Empty>;
  }

  return (
    <>
      <PageHeader kind="mat" title="素材" sub={`${store.name}・素材は「投稿」とは別の記録です`} actions={editable ? <LinkBtn href={`${base}/materials/new`} kind="mat">＋ 素材登録</LinkBtn> : null} />
      {tabs}
      {filterForm}
      <SectionTitle kind="mat" right={<span>{count}件{view === 'items' && count > 300 ? '（先頭300件を表示）' : ''}</span>}>{view === 'batches' ? '素材グループ' : '個別素材'}</SectionTitle>
      {body}
    </>
  );
}
