import { redirect } from 'next/navigation';
import { pageCtx } from '@/lib/page';
import { PageHeader } from '@/components/ui';
import { CastForm } from '@/components/CastForm';

export default async function NewCast({ params }: { params: Promise<{ store: string }> }) {
  const { store, base, editable } = await pageCtx(params);
  if (!editable) redirect(`${base}/casts`);
  return (
    <>
      <PageHeader title="キャスト登録" sub={`所属店舗: ${store.name}（選択中の店舗に登録されます）`} />
      <CastForm storeKey={store.key} castId={null} cancelHref={`${base}/casts`} />
    </>
  );
}
