import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageCtx, one, type SP } from '@/lib/page';
import { getPost } from '@/lib/domain/posts';
import { AppError } from '@/lib/errors';
import { PLATFORM_LABEL, POST_CATEGORY_LABEL } from '@/lib/constants';
import { formatJaDateTime } from '@/lib/jst';
import { Badge, LinkBtn, PageHeader, PostStatusBadge, SectionTitle } from '@/components/ui';
import { VoidPostButton } from '@/components/VoidPostButton';

export default async function PostDetail({ params, searchParams }: { params: Promise<{ store: string; id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, user, store, base, editable } = await pageCtx(params);
  const p = await getPost(db, user, store.id, id).catch((e) => {
    if (e instanceof AppError && e.code === 'not_found') notFound();
    throw e;
  });
  const items = await db.query<{ id: string; code: string; batch_id: string }>(
    `SELECT i.id, i.code, i.batch_id FROM post_materials pm JOIN material_items i ON i.id=pm.item_id WHERE pm.post_id=$1 ORDER BY i.code`,
    [id],
  );
  const created = one(sp.created);
  return (
    <>
      {created ? (
        <p role="status" className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" data-testid="created-banner">
          投稿を{created}件登録しました。
        </p>
      ) : null}
      {one(sp.saved) ? <p role="status" className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" data-testid="saved-banner">変更を保存しました。</p> : null}
      <PageHeader kind="post" title={p.title} sub={`${PLATFORM_LABEL[p.platform]} ・ ${p.category === 'other' && p.other_label ? p.other_label : POST_CATEGORY_LABEL[p.category]}`} actions={editable ? <LinkBtn href={`${base}/posts/${p.id}/edit`} kind="post">編集（状態・日時の更新）</LinkBtn> : null} />
      <div className="card space-y-2 text-sm">
        <div className="flex flex-wrap gap-2">
          <PostStatusBadge status={p.status} />
          {p.material_count === 0 ? <Badge tone="amber">素材未紐付け</Badge> : <Badge tone="mat">素材 {p.material_count}点</Badge>}
        </div>
        {p.set_label ? <p>質問セット: <b>{p.set_label}</b></p> : null}
        {p.quiz_label ? <p>クイズセット: <b>{p.quiz_label}</b></p> : null}
        {p.scheduled_at ? <p>予定日時: {formatJaDateTime(p.scheduled_at)}</p> : null}
        {p.status === 'published' && p.published_at ? <p>実際の投稿日時: <b>{formatJaDateTime(p.published_at)}</b></p> : null}
        {p.original_scheduled_at && p.status === 'published' && p.original_scheduled_at !== p.scheduled_at ? <p className="text-slate-500">当初の予定日時: {formatJaDateTime(p.original_scheduled_at)}</p> : null}
        <p>出演: {p.cast_names.length ? p.cast_names.join('、') : '店舗共通（キャストなし）'}</p>
        {p.format ? <p>投稿形式: {p.format}</p> : null}
        {p.url ? <p>投稿URL: <a className="break-all underline" href={p.url} target="_blank" rel="noopener noreferrer nofollow">{p.url}</a></p> : null}
        {p.public_state_note ? <p>公開状態メモ: {p.public_state_note}</p> : null}
        {p.caption ? <div><p className="font-semibold">キャプション</p><p className="whitespace-pre-wrap">{p.caption}</p></div> : null}
        {p.memo ? <p className="whitespace-pre-wrap">メモ: {p.memo}</p> : null}
        {p.siblings.length ? (
          <p>同時登録の投稿: {p.siblings.map((s) => (<Link key={s.id} className="mr-2 underline" href={`${base}/posts/${s.id}`}>{PLATFORM_LABEL[s.platform]}</Link>))}</p>
        ) : null}
      </div>
      <SectionTitle kind="mat">使用した素材</SectionTitle>
      {items.length ? (
        <ul className="flex flex-wrap gap-2">
          {items.map((i) => (<li key={i.id}><Link className="badge border-mat-100 bg-mat-50 text-mat-700" href={`${base}/materials/${i.batch_id}`}>{i.code}</Link></li>))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">素材は紐付けられていません（素材使用数には数えません）。</p>
      )}
      {editable ? <div className="mt-8"><VoidPostButton storeKey={store.key} postId={p.id} base={base} /></div> : null}
    </>
  );
}
