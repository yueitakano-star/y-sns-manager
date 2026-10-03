import Link from 'next/link';
import { requireStore } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/constants';
import { StoreNav } from '@/components/StoreNav';
import { LogoutButton } from '@/components/LogoutButton';

export const dynamic = 'force-dynamic';

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ store: string }> }) {
  const { store: key } = await params;
  const { user, store, role } = await requireStore(key);
  const base = `/s/${store.key}`;
  return (
    <div className="min-h-dvh pb-20 md:pb-8">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <Link href={base} className="rounded-lg bg-slate-800 px-3 py-1.5 text-lg font-bold tracking-wide text-white" aria-label={`現在の店舗: ${store.name}`} data-testid="store-name">
              {store.name}
            </Link>
            <Link href="/" className="btn-sub !min-h-9 !px-3 !py-1 text-sm" data-testid="switch-store">店舗切替</Link>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="hidden sm:inline">{user.displayName}（{ROLE_LABEL[role]}）</span>
            <LogoutButton />
          </div>
        </div>
        <StoreNav base={base} variant="top" />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4">{children}</main>
      <StoreNav base={base} variant="bottom" />
    </div>
  );
}
