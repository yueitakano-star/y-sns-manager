import { pageCtx, one, type SP } from '@/lib/page';
import { castStats, storeStats } from '@/lib/domain/stats';
import { parsePeriod } from '@/lib/jst';
import { PageHeader, LinkBtn, Empty } from '@/components/ui';
import { PeriodFilter } from '@/components/PeriodFilter';
import { CastFilterForm, CastStatsList, applyCastParams } from '@/components/CastStatsList';

export default async function CastsPage({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  const sp = await searchParams;
  const period = parsePeriod({ period: one(sp.period), from: one(sp.from), to: one(sp.to) });
  const p = { q: one(sp.q), status: one(sp.status), flag: one(sp.flag), sort: one(sp.sort) };
  const all = await castStats(db, user, store.id, period);
  const stats = await storeStats(db, user, store.id, period);
  const rows = applyCastParams(all, p);
  const hidden = { period: one(sp.period), from: one(sp.from), to: one(sp.to) };
  return (
    <>
      <PageHeader title="キャスト" sub={`${store.name}・在籍と非表示を合わせて ${all.length}人`} actions={editable ? <LinkBtn href={`${base}/casts/new`} kind="primary">＋ キャスト登録</LinkBtn> : null} />
      {all.length === 0 ? (
        <Empty action={editable ? <LinkBtn href={`${base}/casts/new`} kind="primary">キャストを登録する</LinkBtn> : undefined}>
          {store.name} にはまだキャストが登録されていません。
        </Empty>
      ) : (
        <>
          <PeriodFilter period={period} hidden={{ q: p.q, status: p.status, flag: p.flag, sort: p.sort }} />
          <CastFilterForm params={p} hidden={hidden} />
          <CastStatsList rows={rows} base={base} common={stats.common} />
        </>
      )}
    </>
  );
}
