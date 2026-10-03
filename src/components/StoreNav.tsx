'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { path: '', label: 'ホーム', icon: '⌂' },
  { path: '/casts', label: 'キャスト', icon: '☺' },
  { path: '/materials', label: '素材', icon: '▣' },
  { path: '/posts', label: '投稿', icon: '✉' },
  { path: '/calendar', label: 'カレンダー', icon: '▦' },
  { path: '/questions', label: '質問集', icon: '？' },
];

export function StoreNav({ base, variant }: { base: string; variant: 'top' | 'bottom' }) {
  const pathname = usePathname();
  const isActive = (p: string) => (p === '' ? pathname === base : pathname.startsWith(base + p));
  if (variant === 'top') {
    return (
      <nav aria-label="店舗メニュー" className="hidden border-t border-slate-200 md:block">
        <ul className="mx-auto flex max-w-6xl gap-1 px-4">
          {ITEMS.map((i) => (
            <li key={i.path}>
              <Link
                href={base + i.path}
                aria-current={isActive(i.path) ? 'page' : undefined}
                className={`block border-b-2 px-4 py-2.5 text-sm font-semibold ${isActive(i.path) ? 'border-slate-800 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label="店舗メニュー（スマホ）" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-300 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid grid-cols-6">
        {ITEMS.map((i) => (
          <li key={i.path}>
            <Link
              href={base + i.path}
              aria-current={isActive(i.path) ? 'page' : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isActive(i.path) ? 'bg-slate-800 text-white' : 'text-slate-600'}`}
            >
              <span className="text-base leading-none" aria-hidden>{i.icon}</span>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
