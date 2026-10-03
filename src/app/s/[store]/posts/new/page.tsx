import { redirect } from 'next/navigation';
import { pageCtx, one, many, type SP } from '@/lib/page';
import { listCasts } from '@/lib/domain/casts';
import { listPickerItems } from '@/lib/domain/materials';
import { listQuestionSets } from '@/lib/domain/stats';
import { PageHeader } from '@/components/ui';
import { PostForm } from '@/components/PostForm';

export default async function NewPost({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  if (!editable) redirect(`${base}/posts`);
  const sp = await searchParams;
  const [casts, items, sets] = await Promise.all([listCasts(db, user, store.id), listPickerItems(db, user, store.id), listQuestionSets(db)]);
  return (
    <>
      <PageHeader kind="post" title="投稿登録" sub={`${store.name} ／ 素材を登録しただけでは投稿件数は増えません。SNSに投稿した（する）記録をここで登録します`} />
      <PostForm
        storeKey={store.key}
        storeName={store.name}
        mode="create"
        casts={casts.map((c) => ({ id: c.id, name: c.display_name, active: c.status === 'active' }))}
        items={items}
        sets={sets.map((s) => ({ id: s.id, set_number: s.set_number, title: s.title }))}
        defaultItemIds={many(sp.item)}
        defaultCastId={one(sp.cast)}
      />
      <span hidden>{base}</span>
    </>
  );
}
