'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logoutAction } from '@/app/actions';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-sub"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await logoutAction().catch(() => {});
        router.push('/login');
        router.refresh();
      }}
    >
      ログアウト
    </button>
  );
}
