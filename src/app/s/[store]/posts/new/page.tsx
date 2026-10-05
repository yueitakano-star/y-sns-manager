import { redirect } from 'next/navigation';
import { pageCtx, one, many, type SP } from '@/lib/page';
import { listCasts } from '@/lib/domain/casts';
import { listPickerItems } from '@/lib/domain/materials';
import { listQuestionSets } from '@/lib/domain/stats';
import { listQuizSets } from '@/lib/domain/quiz';
import { PageHeader } from '@/components/ui';
import { PostForm } from '@/components/PostForm';
import { aiConfigured } from '@/lib/ai';

export default async function NewPost({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  if (!editable) redirect(`${base}/posts`);
  const sp = await searchParams;
  const [casts, items, sets, quizzes] = await Promise.all([listCasts(db, user, store.id), listPickerItems(db, user, store.id), listQuestionSets(db), listQuizSets(db)]);
  return (
    <>
      <PageHeader kind="post" title="投稿登録" sub={`${store.name} ／ 素材を登録しただけでは投稿件数は増えません。SNSに投稿した（する）記録をここで登録します`} />
      <PostForm
        storeKey={store.key}
        storeName={store.name}
        aiReady={aiConfigured()}
        mode="create"
        casts={casts.map((c) => ({ id: c.id, name: c.display_name, active: c.status === 'active' }))}
        items={items}
        sets={sets.map((s) => ({ id: s.id, set_number: s.set_number, title: s.title }))}
        quizzes={quizzes.map((z) => ({ id: z.id, set_number: z.set_number, title: z.title }))}
        defaultCategory={one(sp.category)}
        defaultQuizSetId={one(sp.quiz)}
        defaultItemIds={many(sp.item)}
        defaultCastId={one(sp.cast)}
      />
      <span hidden>{base}</span>
    </>
  );
}
