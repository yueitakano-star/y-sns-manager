import { redirect } from 'next/navigation';
import { pageCtx, one, type SP } from '@/lib/page';
import { listCasts } from '@/lib/domain/casts';
import { jstToday } from '@/lib/jst';
import { PageHeader } from '@/components/ui';
import { ArchiveForm } from '@/components/ArchiveForm';

export default async function NewArchive({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  if (!editable) redirect(`${base}/archive`);
  const sp = await searchParams;
  const casts = await listCasts(db, user, store.id);
  const castId = one(sp.cast);
  return (
    <>
      <PageHeader kind="mat" title="過去素材のリンクを登録" sub={`${store.name} ／ Googleドライブのフォルダやファイルのリンクを記録します`} />
      <ArchiveForm
        storeKey={store.key}
        linkId={null}
        casts={casts.filter((c) => c.status === 'active' || c.id === castId).map((c) => ({ id: c.id, name: c.display_name }))}
        today={jstToday()}
        initial={castId && casts.some((c) => c.id === castId) ? { title: '', url: '', description: '', shotOn: '', purpose: '', castIds: [castId] } : undefined}
      />
    </>
  );
}
