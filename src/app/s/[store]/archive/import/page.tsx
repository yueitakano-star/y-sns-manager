import Link from 'next/link';
import { redirect } from 'next/navigation';
import { pageCtx } from '@/lib/page';
import { listCasts } from '@/lib/domain/casts';
import { driveConfigured, serviceAccountEmail } from '@/lib/gdrive';
import { PageHeader, SectionTitle } from '@/components/ui';
import { DriveImport } from '@/components/DriveImport';

export default async function ImportPage({ params }: { params: Promise<{ store: string }> }) {
  const { db, user, store, base, editable } = await pageCtx(params);
  if (!editable) redirect(`${base}/archive`);
  const casts = await listCasts(db, user, store.id);
  const ready = driveConfigured();
  const mail = serviceAccountEmail();
  return (
    <>
      <PageHeader kind="mat" title="ドライブのフォルダから取り込み" sub={`${store.name} ／ 過去素材のリンクを、フォルダを指定してまとめて登録します`} actions={<Link href={`${base}/archive`} className="btn-sub">過去素材置き場へ戻る</Link>} />
      {!ready ? (
        <div className="card border-amber-300 bg-amber-50 text-sm" data-testid="di-unavailable">
          <p className="font-bold">Googleドライブ連携が未設定です。</p>
          <p className="mt-1">環境変数 <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> を設定すると使えます。手順はリポジトリの <code>docs/GOOGLE_DRIVE_SETUP.md</code> にあります（所要30分ほど）。設定するまでは、「リンクを登録」で1件ずつ登録できます。</p>
        </div>
      ) : (
        <>
          <div className="card mb-4 text-sm">
            <p>取り込みたいフォルダを、次のアドレスに <b>「閲覧者」</b> で共有してください（読み取り専用。ファイルは変更・削除されません）。</p>
            <p className="mt-1 break-all rounded bg-slate-100 p-2 font-mono text-xs" data-testid="di-mail">{mail}</p>
          </div>
          <DriveImport storeKey={store.key} base={base} casts={casts.filter((c) => c.status === 'active').map((c) => ({ id: c.id, name: c.display_name }))} />
        </>
      )}
      <SectionTitle>取り込みについて</SectionTitle>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
        <li>登録するのは<b>リンクと名前だけ</b>です。ファイルをこのサイトにコピーすることはありません。</li>
        <li>同じファイル／フォルダは二重に登録されません（取り込み済みと表示されます）。</li>
        <li>一覧のサムネイルは、サイトがドライブから取得して表示します。共有設定を「リンクを知っている全員」にする必要はありません。</li>
        <li>スタッフが「開く」で元ファイルを見るには、スタッフのGoogleアカウントにもフォルダが共有されている必要があります。</li>
      </ul>
    </>
  );
}
