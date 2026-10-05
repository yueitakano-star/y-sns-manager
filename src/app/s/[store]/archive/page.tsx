import Link from 'next/link';
import { pageCtx, one, type SP } from '@/lib/page';
import { listArchiveLinks, isDriveUrl } from '@/lib/domain/archive';
import { listCasts } from '@/lib/domain/casts';
import { PURPOSES, PURPOSE_LABEL } from '@/lib/constants';
import { Badge, Empty, LinkBtn, PageHeader, SectionTitle, SelectField } from '@/components/ui';

export default async function ArchivePage({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  const sp = await searchParams;
  const casts = await listCasts(db, user, store.id);
  const cast = one(sp.cast);
  const rows = await listArchiveLinks(db, user, store.id, { castId: cast === 'common' ? undefined : cast, common: cast === 'common', purpose: one(sp.purpose), q: one(sp.q) });
  return (
    <>
      <PageHeader kind="mat" title="過去素材置き場" sub={`${store.name}・Googleドライブなどに保管している過去素材へのリンク集（素材の在庫・使用数には含まれません）`}
        actions={editable ? <><LinkBtn href={`${base}/archive/import`} kind="mat">📥 ドライブのフォルダから取り込み</LinkBtn><LinkBtn href={`${base}/archive/new`}>＋ リンクを1件登録</LinkBtn></> : null} />
      {one(sp.saved) ? <p role="status" className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" data-testid="archive-saved">保存しました。</p> : null}
      <form method="get" className="card mb-3 flex flex-wrap items-end gap-3" aria-label="過去素材の絞り込み">
        <label className="block min-w-40 flex-[2] text-sm font-semibold text-slate-700">キーワード
          <input name="q" defaultValue={one(sp.q) ?? ''} className="input mt-1 font-normal" placeholder="タイトル・メモ" />
        </label>
        <SelectField name="cast" label="キャスト" value={cast} options={[{ value: 'common', label: '店舗共通（キャストなし）' }, ...casts.map((c) => ({ value: c.id, label: c.display_name }))]} />
        <SelectField name="purpose" label="用途" value={one(sp.purpose)} options={PURPOSES.map((p) => ({ value: p.key, label: p.name }))} />
        <button className="btn-primary" type="submit">絞り込む</button>
      </form>
      <SectionTitle kind="mat" right={<span>{rows.length}件</span>}>リンク一覧</SectionTitle>
      {rows.length === 0 ? (
        <Empty action={editable ? <LinkBtn href={`${base}/archive/new`} kind="mat">＋ リンクを登録</LinkBtn> : undefined}>登録されたリンクはありません。</Empty>
      ) : (
        <ul className="space-y-2" data-testid="archive-list">
          {rows.map((r) => (
            <li key={r.id} className="card flex gap-3 !p-3">
              {r.source === 'drive' ? (
                <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:size-24">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${base}/archive/${r.id}/thumb`} alt="" loading="lazy" className="size-full object-cover" />
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={isDriveUrl(r.url) ? 'green' : 'slate'}>{isDriveUrl(r.url) ? 'Googleドライブ' : 'リンク'}</Badge>
                {r.purpose ? <Badge tone="blue">{PURPOSE_LABEL[r.purpose]}</Badge> : null}
                {r.shot_on ? <Badge>{r.shot_on}</Badge> : null}
              </div>
              <h3 className="mt-1 font-bold">{r.title}</h3>
              <p className="text-sm text-slate-600">出演: {r.cast_names.length ? r.cast_names.join('、') : '店舗共通（キャストなし）'}</p>
              {r.description ? <p className="mt-1 whitespace-pre-wrap text-sm">{r.description}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <a className="btn-mat" href={r.url} target="_blank" rel="noopener noreferrer nofollow" data-testid="archive-open">開く ↗</a>
                {editable ? <Link className="btn-sub" href={`${base}/archive/${r.id}`}>編集</Link> : null}
              </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
