import { redirect } from 'next/navigation';
import { pageCtx, one, type SP } from '@/lib/page';
import { listCasts } from '@/lib/domain/casts';
import { listQuestionSets } from '@/lib/domain/stats';
import { jstToday } from '@/lib/jst';
import { PageHeader } from '@/components/ui';
import { MaterialForm } from '@/components/MaterialForm';
import { supabaseStorage } from '@/lib/storage';

export default async function NewMaterial({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  if (!editable) redirect(`${base}/materials`);
  const sp = await searchParams;
  const [casts, sets] = await Promise.all([listCasts(db, user, store.id, { activeOnly: true }), listQuestionSets(db)]);
  return (
    <>
      <PageHeader kind="mat" title="素材登録" sub={`${store.name} ／ 店舗 → キャスト → 素材の種類 の順に選びます`} />
      <MaterialForm
        storeKey={store.key}
        storeName={store.name}
        casts={casts.map((c) => ({ id: c.id, name: c.display_name }))}
        sets={sets}
        today={jstToday()}
        defaultCastId={one(sp.cast)}
        defaultCategory={one(sp.category)}
        storageReady={supabaseStorage.configured()}
      />
    </>
  );
}
