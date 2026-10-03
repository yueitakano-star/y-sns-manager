import { notFound, redirect } from 'next/navigation';
import { pageCtx } from '@/lib/page';
import { getPost } from '@/lib/domain/posts';
import { listCasts } from '@/lib/domain/casts';
import { listPickerItems } from '@/lib/domain/materials';
import { listQuestionSets } from '@/lib/domain/stats';
import { AppError } from '@/lib/errors';
import { toJstLocal } from '@/lib/jst';
import { PageHeader } from '@/components/ui';
import { PostForm } from '@/components/PostForm';

export default async function EditPost({ params }: { params: Promise<{ store: string; id: string }> }) {
  const { id } = await params;
  const { db, user, store, base, editable } = await pageCtx(params);
  if (!editable) redirect(`${base}/posts/${id}`);
  const p = await getPost(db, user, store.id, id).catch((e) => {
    if (e instanceof AppError && e.code === 'not_found') notFound();
    throw e;
  });
  const [casts, items, sets] = await Promise.all([listCasts(db, user, store.id), listPickerItems(db, user, store.id), listQuestionSets(db)]);
  return (
    <>
      <PageHeader kind="post" title="投稿を編集" sub={`${store.name} ／ 予定を投稿済みにする場合も、この投稿を更新します（新規作成しないので二重計上されません）`} />
      <PostForm
        storeKey={store.key}
        storeName={store.name}
        mode="edit"
        postId={p.id}
        casts={casts.map((c) => ({ id: c.id, name: c.display_name, active: c.status === 'active' }))}
        items={items}
        sets={sets.map((s) => ({ id: s.id, set_number: s.set_number, title: s.title }))}
        initial={{
          category: p.category,
          otherLabel: p.other_label ?? '',
          questionSetId: p.question_set_id ?? '',
          title: p.title,
          itemIds: p.item_ids,
          castIds: p.cast_ids,
          caption: p.caption ?? '',
          memo: p.memo ?? '',
          platform: p.platform,
          unlinkedLegacy: p.material_count === 0,
          target: {
            status: p.status,
            scheduledAt: p.scheduled_at ? toJstLocal(p.scheduled_at) : '',
            publishedAt: p.published_at ? toJstLocal(p.published_at) : '',
            url: p.url ?? '',
            format: p.format ?? '',
            publicStateNote: p.public_state_note ?? '',
          },
        }}
      />
    </>
  );
}
