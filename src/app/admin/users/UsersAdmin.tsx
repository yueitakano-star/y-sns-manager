'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { inviteUserAction, setMembershipAction, setUserActiveAction } from '@/app/actions';
import { ROLE_LABEL, type Role } from '@/lib/constants';
import { ErrorBanner, Field, SuccessBanner, useSubmitter } from '@/components/forms';

interface U { id: string; email: string; display_name: string; is_system_admin: boolean; is_active: boolean; memberships: Record<string, Role> }

export function UsersAdmin({ stores, users, meId }: { stores: { id: string; name: string }[]; users: U[]; meId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<Record<string, Role | ''>>({});
  const inv = useSubmitter();
  const row = useSubmitter();
  const [ok, setOk] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <form className="card space-y-3" noValidate onSubmit={(e) => {
        e.preventDefault();
        setOk(null);
        void inv.submit(
          () => inviteUserAction({ email, displayName: name, password, memberships: Object.entries(roles).filter(([, r]) => r).map(([storeId, role]) => ({ storeId, role: role as Role })) }),
          () => { setOk(`${email} を登録しました。初期パスワードを本人に安全な方法で伝えてください。`); setEmail(''); setName(''); setPassword(''); setRoles({}); router.refresh(); },
        );
      }}>
        <h2 className="font-bold">ユーザーを招待（アカウント発行）</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="メールアドレス" htmlFor="inv-email" error={inv.fields.email} required><input id="inv-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
          <Field label="表示名" htmlFor="inv-name" error={inv.fields.displayName} required><input id="inv-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="初期パスワード（10文字以上）" htmlFor="inv-pw" error={inv.fields.password} required><input id="inv-pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <fieldset>
          <legend className="label">利用できる店舗と権限</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {stores.map((s) => (
              <label key={s.id} className="text-sm font-semibold">{s.name}
                <select className="input mt-1 font-normal" value={roles[s.id] ?? ''} onChange={(e) => setRoles((p) => ({ ...p, [s.id]: e.target.value as Role | '' }))}>
                  <option value="">権限なし</option>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (<option key={r} value={r}>{ROLE_LABEL[r]}</option>))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorBanner message={inv.error} />
        <SuccessBanner message={ok} />
        <button type="submit" className="btn-primary" disabled={inv.busy}>{inv.busy ? '登録中…' : '招待する'}</button>
      </form>

      <section>
        <h2 className="mb-2 font-bold">登録ユーザー</h2>
        <ErrorBanner message={row.error} />
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-bold">{u.display_name}</span> <span className="text-sm text-slate-600">{u.email}</span>
                  {u.is_system_admin ? <span className="badge ml-2 border-slate-800 bg-slate-800 text-white">システム管理者</span> : null}
                  {!u.is_active ? <span className="badge ml-2 border-red-300 bg-red-50 text-red-700">無効</span> : null}
                </div>
                {u.id !== meId ? (
                  <button type="button" className="btn-sub" disabled={row.busy} onClick={() => void row.submit(() => setUserActiveAction(u.id, !u.is_active), () => router.refresh())}>{u.is_active ? '無効にする' : '有効にする'}</button>
                ) : null}
              </div>
              {u.is_system_admin ? <p className="text-xs text-slate-500">システム管理者は全店舗を管理者として利用できます。</p> : (
                <div className="grid gap-2 sm:grid-cols-3">
                  {stores.map((s) => (
                    <label key={s.id} className="text-xs font-semibold">{s.name}
                      <select className="input mt-1 font-normal" value={u.memberships[s.id] ?? ''} disabled={row.busy}
                        onChange={(e) => void row.submit(() => setMembershipAction(u.id, s.id, (e.target.value || null) as Role | null), () => router.refresh())}>
                        <option value="">権限なし</option>
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (<option key={r} value={r}>{ROLE_LABEL[r]}</option>))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
