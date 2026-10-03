import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { ROLE_LABEL, type Role } from '@/lib/constants';
import { UsersAdmin } from './UsersAdmin';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const me = await requireUser();
  if (!me.isSystemAdmin) redirect('/');
  const db = await getDb();
  const stores = await db.query<{ id: string; name: string }>('SELECT id, name FROM stores ORDER BY sort_order');
  const users = await db.query<{ id: string; email: string; display_name: string; is_system_admin: boolean; is_active: boolean }>(
    'SELECT id, email, display_name, is_system_admin, is_active FROM users ORDER BY created_at',
  );
  const ms = await db.query<{ user_id: string; store_id: string; role: Role }>('SELECT user_id, store_id, role FROM user_store_memberships');
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">ユーザー管理（システム管理者）</h1>
        <Link href="/" className="btn-sub">店舗選択へ</Link>
      </div>
      <p className="mb-4 text-sm text-slate-600">このサイトは自己登録できません。ここでアカウントを発行し、店舗ごとの権限（{Object.values(ROLE_LABEL).join('／')}）を付与します。</p>
      <UsersAdmin
        stores={stores}
        meId={me.userId}
        users={users.map((u) => ({ ...u, memberships: Object.fromEntries(ms.filter((m) => m.user_id === u.id).map((m) => [m.store_id, m.role])) }))}
      />
    </main>
  );
}
