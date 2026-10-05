import Link from 'next/link';
import type { BatchListRow, PickerItem } from '@/lib/domain/materials';
import { CATEGORY_BY_KEY, MEDIA_LABEL, PURPOSE_LABEL, UNIT } from '@/lib/constants';
import { Badge, MaterialStatusBadge } from './ui';
import { withDownload } from '@/lib/download';

export interface Thumb {
  url: string;
  type: string;
}

function Preview({ thumb, kind, alt }: { thumb?: Thumb; kind: 'image' | 'video' | 'other'; alt: string }) {
  if (thumb?.type.startsWith('image/')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumb.url} alt={alt} loading="lazy" className="size-full object-cover" />;
  }
  if (thumb?.type.startsWith('video/')) {
    return <video src={`${thumb.url}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" aria-label={alt} />;
  }
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1 bg-slate-100 text-slate-500">
      <span className="text-3xl" aria-hidden>{kind === 'video' ? '▶' : kind === 'image' ? '▣' : '▤'}</span>
      <span className="text-xs">ファイル未登録</span>
    </div>
  );
}

/** 素材グループのグリッド表示（代表サムネイル＋要点） */
export function BatchGrid({ rows, base, thumbs }: { rows: BatchListRow[]; base: string; thumbs: Record<string, Thumb> }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" data-testid="batch-grid">
      {rows.map((b) => (
        <li key={b.id}>
          <Link href={`${base}/materials/${b.id}`} className="block overflow-hidden rounded-xl border border-slate-200 bg-white hover:border-mat-600">
            <div className="relative aspect-square bg-slate-100">
              <Preview thumb={thumbs[b.id]} kind={b.media_kind} alt={b.title} />
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-xs font-bold text-white">{b.item_count}{UNIT[b.media_kind]}</span>
              {b.used_count > 0 ? <span className="absolute right-1 top-1 rounded bg-post-600 px-1.5 text-xs font-bold text-white">使用済み</span> : null}
            </div>
            <div className="space-y-0.5 p-2">
              <p className="truncate text-sm font-bold">{b.title}</p>
              <p className="truncate text-xs text-slate-600">{b.cast_names.length ? b.cast_names.join('、') : '店舗共通'}</p>
              <p className="truncate text-xs text-slate-500">{CATEGORY_BY_KEY[b.category].name} ・ {MEDIA_LABEL[b.media_kind]}</p>
              <div className="flex flex-wrap gap-1 pt-0.5">
                <MaterialStatusBadge status={b.status} />
                {b.purpose ? <Badge tone="blue">{PURPOSE_LABEL[b.purpose]}</Badge> : null}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 個別素材のグリッド表示（チェックして投稿登録へ進める） */
export function ItemGrid({ items, base, thumbs, downloads, action }: { items: PickerItem[]; base: string; thumbs: Record<string, Thumb>; downloads: Record<string, { url: string; name: string }>; action: string }) {
  return (
    <form method="get" action={action}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">チェックした素材で投稿を登録できます。</p>
        <button type="submit" className="btn-post">選択した素材で投稿登録 →</button>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" data-testid="item-grid">
        {items.map((i) => (
          <li key={i.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="relative aspect-square bg-slate-100">
              <Link href={`${base}/materials/${i.batch_id}`} aria-label={`${i.code} の詳細`}>
                <Preview thumb={thumbs[i.id]} kind={i.media_kind} alt={i.code} />
              </Link>
              <label className="absolute left-1 top-1 flex size-9 cursor-pointer items-center justify-center rounded bg-white/90">
                <input type="checkbox" name="item" value={i.id} className="size-5" aria-label={`${i.code} を選択`} />
              </label>
              {i.published_count > 0 ? <span className="absolute right-1 top-1 rounded bg-post-600 px-1.5 text-xs font-bold text-white">使用済み{i.published_count}</span> : null}
            </div>
            <div className="space-y-0.5 p-2">
              <p className="truncate font-mono text-xs font-semibold">{i.code}</p>
              <p className="truncate text-xs text-slate-600">{i.cast_names.length ? i.cast_names.join('、') : '店舗共通'}</p>
              {downloads[i.id] ? <a className="block text-xs font-bold text-mat-700 underline" href={withDownload(downloads[i.id].url, downloads[i.id].name)} download={downloads[i.id].name} data-testid="grid-download">⬇ 保存</a> : null}
              <div className="flex flex-wrap gap-1">
                <MaterialStatusBadge status={i.status} />
                {i.purpose ? <Badge tone="blue">{PURPOSE_LABEL[i.purpose as keyof typeof PURPOSE_LABEL]}</Badge> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </form>
  );
}
