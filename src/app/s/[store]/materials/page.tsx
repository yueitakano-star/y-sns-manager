import Link from 'next/link';
import { pageCtx, one, type SP } from '@/lib/page';
import { listBatches, listPickerItems } from '@/lib/domain/materials';
import { listCasts } from '@/lib/domain/casts';
import { CATEGORIES, MATERIAL_STATES, PURPOSES } from '@/lib/constants';
import { Empty, LinkBtn, PageHeader, SectionTitle, SelectField } from '@/components/ui';
import { BatchList, ItemSelectList } from '@/components/lists';
import { BatchGrid, ItemGrid, type Thumb } from '@/components/MaterialGrid';
import { listCoverFiles, listFiles } from '@/lib/domain/files';
import { supabaseStorage } from '@/lib/storage';

export default async function MaterialsPage({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  const sp = await searchParams;
  const view = one(sp.view) === 'items' ? 'items' : 'batches';
  const layout = one(sp.layout) === 'list' ? 'list' : 'grid';
  const withParams = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) p.set(k, v);
    for (const [k, v] of Object.entries(over)) p.set(k, v);
    return `?${p.toString()}`;
  };
  const f = { category: one(sp.category), castId: one(sp.cast), status: one(sp.status), purpose: one(sp.purpose), usage: (one(sp.usage) as 'all' | 'unused' | 'used' | undefined) ?? 'all', common: one(sp.cast) === 'common' };
  const casts = await listCasts(db, user, store.id);
  const castFilter = f.common ? undefined : f.castId;
  const filterForm = (
    <form method="get" className="card mb-3 flex flex-wrap items-end gap-3" aria-label="素材の絞り込み">
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="layout" value={layout} />
      <SelectField name="category" label="種類" value={f.category} options={CATEGORIES.map((c) => ({ value: c.key, label: c.name }))} />
      <SelectField name="cast" label="キャスト" value={one(sp.cast)} options={[{ value: 'common', label: '店舗共通（キャストなし）' }, ...casts.map((c) => ({ value: c.id, label: c.display_name + (c.status === 'inactive' ? '（退店）' : '') }))]} />
      <SelectField name="status" label="作業状態" value={f.status} options={MATERIAL_STATES.map((s) => ({ value: s.key, label: s.name }))} />
      <SelectField name="purpose" label="用途" value={f.purpose} options={PURPOSES.map((p) => ({ value: p.key, label: p.name }))} />
      <SelectField name="usage" label="使用状況" value={f.usage === 'all' ? '' : f.usage} options={[{ value: 'unused', label: '未使用あり' }, { value: 'used', label: '投稿に使用済み' }]} />
      <button className="btn-primary" type="submit">絞り込む</button>
    </form>
  );

  const tabs = (
    <div className="mb-3 flex gap-2" role="tablist">
      <Link role="tab" aria-selected={view === 'batches'} href={withParams({ view: 'batches' })} className={view === 'batches' ? 'btn-primary' : 'btn-sub'}>グループ別</Link>
      <Link role="tab" aria-selected={view === 'items'} href={withParams({ view: 'items', usage: 'unused' })} className={view === 'items' ? 'btn-primary' : 'btn-sub'}>個別素材（未使用から選ぶ）</Link>
    </div>
  );

  const layoutToggle = (
    <div className="mb-3 flex gap-2" role="group" aria-label="表示形式">
      <Link href={withParams({ layout: 'list' })} aria-pressed={layout === 'list'} className={layout === 'list' ? 'btn-primary' : 'btn-sub'} data-testid="layout-list">☰ 詳細リスト</Link>
      <Link href={withParams({ layout: 'grid' })} aria-pressed={layout === 'grid'} className={layout === 'grid' ? 'btn-primary' : 'btn-sub'} data-testid="layout-grid">▦ グリッド</Link>
    </div>
  );
  const GRID_MAX = 120;
  const sign = async (files: { path: string; type: string }[]): Promise<Record<string, string>> => (supabaseStorage.configured() ? supabaseStorage.createThumbUrls(files) : {});

  let body: React.ReactNode;
  let count = 0;
  if (view === 'batches') {
    const rows = await listBatches(db, user, store.id, { category: f.category, castId: castFilter, status: f.status, purpose: f.purpose, usage: f.usage, common: f.common });
    count = rows.length;
    let thumbs: Record<string, Thumb> = {};
    if (layout === 'grid' && rows.length) {
      const shown = rows.slice(0, GRID_MAX);
      const covers = await listCoverFiles(db, user, store.id, shown.map((r) => r.id));
      const urls = await sign(covers.map((c) => ({ path: c.storage_path, type: c.content_type })));
      thumbs = Object.fromEntries(covers.filter((c) => urls[c.storage_path]).map((c) => [c.batch_id, { url: urls[c.storage_path], type: c.content_type }]));
      rows.length = Math.min(rows.length, GRID_MAX);
    }
    body = rows.length ? (layout === 'grid' ? <BatchGrid rows={rows} base={base} thumbs={thumbs} /> : <BatchList rows={rows} base={base} />) : (
      <Empty action={editable ? <LinkBtn href={`${base}/materials/new`} kind="mat">＋ 素材登録</LinkBtn> : undefined}>該当する素材はありません。</Empty>
    );
  } else {
    let items = await listPickerItems(db, user, store.id);
    if (f.category) items = items.filter((i) => i.category === f.category);
    if (f.status) items = items.filter((i) => i.status === f.status);
    if (f.purpose) items = items.filter((i) => i.purpose === f.purpose);
    if (f.common) items = items.filter((i) => i.cast_ids.length === 0);
    else if (f.castId) items = items.filter((i) => i.cast_ids.includes(f.castId as string));
    if (f.usage === 'unused') items = items.filter((i) => i.published_count === 0);
    if (f.usage === 'used') items = items.filter((i) => i.published_count > 0);
    count = items.length;
    if (layout === 'grid' && items.length) {
      const shown = items.slice(0, GRID_MAX);
      const files = await listFiles(db, user, store.id, shown.map((i) => i.id));
      const first = new Map<string, { path: string; type: string }>();
      for (const fl of files) if (!first.has(fl.item_id) || (fl.content_type.startsWith('image/') && !first.get(fl.item_id)!.type.startsWith('image/'))) first.set(fl.item_id, { path: fl.storage_path, type: fl.content_type });
      const urls = await sign([...first.values()].map((x) => ({ path: x.path, type: x.type })));
      const thumbs: Record<string, Thumb> = {};
      for (const [id, x] of first) if (urls[x.path]) thumbs[id] = { url: urls[x.path], type: x.type };
      const originals = supabaseStorage.configured() ? await supabaseStorage.createDownloadUrls([...first.values()].map((x) => x.path)) : {};
      const names = new Map(files.map((fl) => [fl.storage_path, fl.file_name]));
      const downloads: Record<string, { url: string; name: string }> = {};
      for (const [id, x] of first) if (originals[x.path]) downloads[id] = { url: originals[x.path], name: names.get(x.path) ?? 'file' };
      body = <ItemGrid items={shown} base={base} thumbs={thumbs} downloads={downloads} action={`${base}/posts/new`} />;
    } else {
      body = items.length ? <ItemSelectList items={items.slice(0, 300)} castNames action={`${base}/posts/new`} /> : <Empty>該当する個別素材はありません。</Empty>;
    }
  }

  return (
    <>
      <PageHeader kind="mat" title="素材" sub={`${store.name}・素材は「投稿」とは別の記録です`} actions={editable ? <LinkBtn href={`${base}/materials/new`} kind="mat">＋ 素材登録</LinkBtn> : null} />
      {tabs}
      {layoutToggle}
      {filterForm}
      <SectionTitle kind="mat" right={<span>{count}件{layout === 'grid' && count > GRID_MAX ? `（先頭${GRID_MAX}件を表示）` : view === 'items' && count > 300 ? '（先頭300件を表示）' : ''}</span>}>{view === 'batches' ? '素材グループ' : '個別素材'}</SectionTitle>
      {body}
    </>
  );
}
