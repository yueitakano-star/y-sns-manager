import Link from 'next/link';
import { requireUser, userStores } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/constants';
import { LogoutButton } from '@/components/LogoutButton';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const stores = await userStores(user);
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">店舗を選択</h1>
          <p className="text-sm text-slate-600">作業する店舗を選んでください。（{user.displayName}）</p>
        </div>
        <div className="flex gap-2">
          {user.isSystemAdmin ? <Link href="/admin/users" className="btn-sub">ユーザー管理</Link> : null}
          <LogoutButton />
        </div>
      </div>
      {sp.denied ? (
        <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          その店舗を表示する権限がありません。
        </p>
      ) : null}
      {stores.length === 0 ? (
        <div className="card text-sm text-slate-700">
          利用できる店舗がありません。管理者に店舗の権限付与を依頼してください。
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-1">
          {stores.map((s) => (
            <li key={s.id}>
              <Link
                href={`/s/${s.key}`}
                className="flex min-h-28 items-center justify-between rounded-2xl border-2 border-slate-300 bg-white px-6 py-5 shadow-sm transition hover:border-slate-800 hover:shadow-md"
              >
                <span>
                  <span className="block text-3xl font-bold tracking-wide">{s.name}</span>
                  <span className="mt-1 block text-sm text-slate-500">店舗コード {s.code}</span>
                </span>
                <span className="text-right text-sm text-slate-600">
                  <span className="badge border-slate-300 bg-slate-100 text-slate-700">{ROLE_LABEL[s.role]}</span>
                  <span className="mt-2 block text-xl" aria-hidden>›</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
