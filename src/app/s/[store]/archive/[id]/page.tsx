import { notFound, redirect } from 'next/navigation';
import { pageCtx } from '@/lib/page';
import { getArchiveLink } from '@/lib/domain/archive';
import { listCasts } from '@/lib/domain/casts';
import { AppError } from '@/lib/errors';
import { jstToday } from '@/lib/jst';
import { PageHeader } from '@/components/ui';
import { ArchiveForm, VoidArchiveButton } from '@/components/ArchiveForm';

export default async function EditArchive({ params }: { params: Promise<{ store: string; id: string }> }) {
  const { id } = await params;
  const { db, user, store, base, editable } = await pageCtx(params);
  if (!editable) redirect(`${base}/archive`);
  const link = await getArchiveLink(db, user, store.id, id).catch((e) => {
    if (e instanceof AppError && e.code === 'not_found') notFound();
    throw e;
  });
  const casts = await listCasts(db, user, store.id);
  return (
    <>
      <PageHeader kind="mat" title="リンクを編集" sub={store.name} />
      <ArchiveForm
        storeKey={store.key}
        linkId={link.id}
        today={jstToday()}
        casts={casts.filter((c) => c.status === 'active' || link.cast_ids.includes(c.id)).map((c) => ({ id: c.id, name: c.display_name }))}
        initial={{ title: link.title, url: link.url, description: link.description ?? '', shotOn: link.shot_on ?? '', purpose: link.purpose ?? '', castIds: link.cast_ids }}
      />
      <div className="mt-6 max-w-2xl"><VoidArchiveButton storeKey={store.key} linkId={link.id} /></div>
    </>
  );
}
