import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageCtx, one, type SP } from '@/lib/page';
import { getBatchDetail } from '@/lib/domain/materials';
import { listCasts } from '@/lib/domain/casts';
import { AppError } from '@/lib/errors';
import { MEDIA_LABEL, PLATFORM_LABEL, UNIT, setLabel } from '@/lib/constants';
import { jstToday } from '@/lib/jst';
import { Badge, LinkBtn, MaterialStatusBadge, PageHeader, PostStatusBadge, SectionTitle } from '@/components/ui';
import { categoryName } from '@/components/lists';
import { AnswerEditor, BatchEditForm, ItemsManager, VoidBatchButton } from '@/components/BatchManager';
import type { PostStatus } from '@/lib/constants';
import { listFiles } from '@/lib/domain/files';
import { supabaseStorage } from '@/lib/storage';

export default async function MaterialDetail({ params, searchParams }: { params: Promise<{ store: string; id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, user, store, base, editable } = await pageCtx(params);
  const b = await getBatchDetail(db, user, store.id, id).catch((e) => {
    if (e instanceof AppError && e.code === 'not_found') notFound();
    throw e;
  });
  const casts = await listCasts(db, user, store.id, { activeOnly: true });
  const codeById = new Map(b.items.concat(b.voidedItems).map((i) => [i.id, i.code]));
  const today = jstToday();
  const fileRows = await listFiles(db, user, store.id, b.items.map((i) => i.id));
  const urls = await Promise.all(fileRows.map((f) => (supabaseStorage.configured() ? supabaseStorage.createDownloadUrl(f.storage_path) : Promise.resolve(null))));
  const filesByItem = new Map<string, { id: string; file_name: string; content_type: string; size_bytes: number; url: string | null }[]>();
  fileRows.forEach((f, i) => filesByItem.set(f.item_id, [...(filesByItem.get(f.item_id) ?? []), { id: f.id, file_name: f.file_name, content_type: f.content_type, size_bytes: Number(f.size_bytes), url: urls[i] }]));
  const castNames = [...new Set(b.items.flatMap((i) => i.cast_names))];

  return (
    <>
      {one(sp.created) ? (
        <p role="status" className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" data-testid="created-banner">
          素材を登録しました（{b.items.length}{UNIT[b.media_kind]}の個別素材を作成）。投稿件数はまだ増えていません。
        </p>
      ) : null}
      {one(sp.upload_failed) ? (
        <p role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          素材は登録しましたが、{one(sp.upload_failed)}件のファイルのアップロードに失敗しました。下の各個別素材の「＋ ファイルを追加」からやり直してください。
        </p>
      ) : null}
      <PageHeader
        kind="mat"
        title={b.title}
        sub={<><span className="font-mono">{b.display_code}</span> ・ {categoryName(b.category, b.other_label)} ・ 撮影・作成日 {b.shot_on}</>}
        actions={editable ? <LinkBtn href={`${base}/posts/new?${b.items.map((i) => `item=${i.id}`).join('&')}`} kind="post">この素材で投稿登録</LinkBtn> : null}
      />
      <div className="card space-y-2 text-sm">
        <div className="flex flex-wrap gap-2"><MaterialStatusBadge status={b.status} /><Badge tone="mat">{MEDIA_LABEL[b.media_kind]} {b.items.length}{UNIT[b.media_kind]}</Badge></div>
        <p>出演: {castNames.length ? castNames.join('、') : '店舗共通（キャストなし）'}</p>
        {b.storage_url ? <p>保存場所: <a className="break-all underline" href={b.storage_url} target="_blank" rel="noopener noreferrer nofollow">{b.storage_url}</a></p> : <p className="text-slate-500">保存場所URLは未設定です。</p>}
        {b.memo ? <p className="whitespace-pre-wrap">メモ: {b.memo}</p> : null}
      </div>
      {editable ? (
        <div className="mt-3">
          <BatchEditForm storeKey={store.key} batchId={b.id} today={today} showOtherLabel={b.category === 'other'}
            initial={{ title: b.title, shotOn: b.shot_on, status: b.status, storageUrl: b.storage_url ?? '', memo: b.memo ?? '', otherLabel: b.other_label ?? '' }} />
        </div>
      ) : null}

      {b.session ? (
        <>
          <SectionTitle kind="mat">{setLabel(b.session.set_number, b.session.set_title)}（{b.session.take_no}回目の撮影・{b.session.shot_on}）</SectionTitle>
          <p className="mb-2 text-sm text-slate-600">素材をNG・編集中にしても、実際に回答した履歴は残ります。後日回答した場合は回答日を更新してください。</p>
          <AnswerEditor
            storeKey={store.key}
            sessionId={b.session.id}
            shotOn={b.session.shot_on}
            today={today}
            editable={editable}
            answers={b.session.answers.map((a) => ({ castId: a.cast_id, castName: a.cast_name, questionId: a.question_id, position: a.position, text: a.text, status: a.status, answeredOn: a.answered_on }))}
          />
        </>
      ) : null}

      <SectionTitle kind="mat" right={<span>{b.items.length}{UNIT[b.media_kind]}</span>}>個別素材</SectionTitle>
      <ItemsManager
        storeKey={store.key}
        base={base}
        batchId={b.id}
        editable={editable}
        storageReady={supabaseStorage.configured()}
        castOptions={casts.map((c) => ({ id: c.id, name: c.display_name }))}
        items={b.items.map((i) => ({ id: i.id, code: i.code, status: i.status, memo: i.memo ?? '', published_count: i.published_count, scheduled_count: i.scheduled_count, cast_names: i.cast_names, files: filesByItem.get(i.id) ?? [], derived_from_code: i.derived_from_item_id ? (codeById.get(i.derived_from_item_id) ?? null) : null }))}
      />
      {b.voidedItems.length ? (
        <p className="mt-2 text-xs text-slate-500">取消済みの個別素材（集計から除外・番号は再利用しません）: {b.voidedItems.map((i) => i.code).join('、')}</p>
      ) : null}

      <SectionTitle kind="post">この素材を使った投稿</SectionTitle>
      {b.posts.length ? (
        <ul className="space-y-2">
          {b.posts.map((p) => (
            <li key={p.id}>
              <Link href={`${base}/posts/${p.id}`} className="card flex flex-wrap items-center gap-2 !p-3 hover:border-post-600">
                <PostStatusBadge status={p.status as PostStatus} /> <Badge>{PLATFORM_LABEL[p.platform as keyof typeof PLATFORM_LABEL]}</Badge> <span className="font-semibold">{p.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">まだ投稿に紐付いていません。</p>
      )}

      {editable ? <div className="mt-8"><VoidBatchButton storeKey={store.key} batchId={b.id} base={base} /></div> : null}
    </>
  );
}
