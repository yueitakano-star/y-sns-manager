import { notFound, redirect } from 'next/navigation';
import { pageCtx } from '@/lib/page';
import { getCast } from '@/lib/domain/casts';
import { AppError } from '@/lib/errors';
import { PageHeader } from '@/components/ui';
import { CastForm } from '@/components/CastForm';

export default async function EditCast({ params }: { params: Promise<{ store: string; id: string }> }) {
  const { id } = await params;
  const { db, user, store, base, editable } = await pageCtx(params);
  if (!editable) redirect(`${base}/casts/${id}`);
  const cast = await getCast(db, user, store.id, id).catch((e) => {
    if (e instanceof AppError && e.code === 'not_found') notFound();
    throw e;
  });
  return (
    <>
      <PageHeader title={`${cast.display_name} を編集`} sub={`所属店舗: ${store.name}`} />
      <CastForm
        storeKey={store.key}
        castId={cast.id}
        cancelHref={`${base}/casts/${cast.id}`}
        initial={{
          displayName: cast.display_name,
          furigana: cast.furigana ?? '',
          sortOrder: cast.sort_order == null ? '' : String(cast.sort_order),
          memo: cast.memo ?? '',
          photoUrl: cast.photo_url ?? '',
          status: cast.status,
        }}
      />
    </>
  );
}
