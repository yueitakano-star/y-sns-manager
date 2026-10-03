import Link from 'next/link';
import type { BatchListRow, PickerItem } from '@/lib/domain/materials';
import type { PostRow } from '@/lib/domain/posts';
import { CATEGORY_BY_KEY, MEDIA_LABEL, PLATFORM_LABEL, POST_CATEGORY_LABEL, PURPOSE_LABEL, UNIT } from '@/lib/constants';
import { formatJaDateTime, jstDate } from '@/lib/jst';
import { Badge, MaterialStatusBadge, PostStatusBadge } from './ui';

export function categoryName(category: keyof typeof CATEGORY_BY_KEY, otherLabel?: string | null) {
  const c = CATEGORY_BY_KEY[category].name;
  return category === 'other' && otherLabel ? `${c}（${otherLabel}）` : c;
}

export function BatchList({ rows, base }: { rows: BatchListRow[]; base: string }) {
  return (
    <ul className="space-y-2" data-testid="batch-list">
      {rows.map((b) => (
        <li key={b.id}>
          <Link href={`${base}/materials/${b.id}`} className="card block !p-3 hover:border-mat-600">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge border-mat-100 bg-mat-50 text-mat-700">▣ 素材</span>
              <span className="font-mono text-xs text-slate-500">{b.display_code}</span>
              <MaterialStatusBadge status={b.status} />
              {b.purpose ? <Badge tone="blue">{PURPOSE_LABEL[b.purpose]}</Badge> : null}
              {b.used_count > 0 ? <Badge tone="post">投稿に使用 {b.used_count}/{b.item_count}</Badge> : <Badge>未使用</Badge>}
            </div>
            <div className="mt-1 font-bold">{b.title}</div>
            <div className="mt-0.5 text-sm text-slate-600">
              {categoryName(b.category, b.other_label)}
              {b.question_set_label ? ` ・ ${b.question_set_label}` : ''} ・ {MEDIA_LABEL[b.media_kind]}{b.item_count}{UNIT[b.media_kind]} ・ 撮影・作成日 {b.shot_on}
            </div>
            <div className="mt-0.5 text-sm text-slate-600">出演: {b.cast_names.length ? b.cast_names.join('、') : '店舗共通（キャストなし）'}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 個別素材の一覧（チェックして投稿登録へ進める） */
export function ItemSelectList({ items, castNames, action }: { items: PickerItem[]; castNames?: boolean; action: string }) {
  return (
    <form method="get" action={action}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">選択した素材を使って投稿を登録できます。</p>
        <button type="submit" className="btn-post">選択した素材で投稿登録 →</button>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" data-testid="item-select-list">
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex min-h-12 cursor-pointer items-start gap-3 p-3">
              <input type="checkbox" name="item" value={i.id} className="mt-1 size-5" />
              <span className="min-w-0 flex-1">
                <span className="font-mono text-sm font-semibold">{i.code}</span>
                <span className="ml-2"><MaterialStatusBadge status={i.status} /></span>
                <span className="block truncate text-sm text-slate-600">
                  {categoryName(i.category)} ・ {i.batch_title}
                  {castNames ? ` ・ ${i.cast_names.length ? i.cast_names.join('、') : '店舗共通'}` : ''}
                </span>
              </span>
              <span className="text-xs text-slate-500">{MEDIA_LABEL[i.media_kind]}</span>
            </label>
          </li>
        ))}
      </ul>
    </form>
  );
}

export function PostList({ rows, base }: { rows: PostRow[]; base: string }) {
  return (
    <ul className="space-y-2" data-testid="post-list">
      {rows.map((p) => (
        <li key={p.id}>
          <Link href={`${base}/posts/${p.id}`} className="card block !p-3 hover:border-post-600">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge border-post-100 bg-post-50 text-post-700">✉ 投稿</span>
              <PostStatusBadge status={p.status} />
              <Badge tone="slate">{PLATFORM_LABEL[p.platform]}</Badge>
              {p.material_count === 0 ? <Badge tone="amber">素材未紐付け</Badge> : <Badge tone="mat">素材 {p.material_count}点</Badge>}
            </div>
            <div className="mt-1 font-bold">{p.title}</div>
            <div className="mt-0.5 text-sm text-slate-600">
              {p.category === 'other' && p.other_label ? p.other_label : POST_CATEGORY_LABEL[p.category]}
              {p.set_label ? ` ・ ${p.set_label}` : ''} ・{' '}
              {p.status === 'published' && p.published_at ? `投稿 ${formatJaDateTime(p.published_at)}` : p.scheduled_at ? `予定 ${formatJaDateTime(p.scheduled_at)}` : `登録 ${jstDate(p.created_at)}`}
            </div>
            <div className="mt-0.5 text-sm text-slate-600">出演: {p.cast_names.length ? p.cast_names.join('、') : '店舗共通（キャストなし）'}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
