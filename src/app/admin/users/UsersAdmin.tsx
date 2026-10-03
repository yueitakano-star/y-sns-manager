'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { inviteUserAction, setMembershipAction, setUserActiveAction, setUserPinAction } from '@/app/actions';
import { ROLE_LABEL, type Role } from '@/lib/constants';
import { ErrorBanner, Field, SuccessBanner, useSubmitter } from '@/components/forms';

interface U { id: string; email: string | null; login_name: string | null; display_name: string; is_system_admin: boolean; is_active: boolean; memberships: Record<string, Role> }

function PinReset({ userId }: { userId: string }) {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const s = useSubmitter();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="PINを再設定（4〜8桁の数字）" htmlFor={`pin-${userId}`} error={s.fields.pin}>
        <input id={`pin-${userId}`} inputMode="numeric" className="input !w-40" value={pin} onChange={(e) => setPin(e.target.value)} />
      </Field>
      <button type="button" className="btn-sub" disabled={s.busy || !pin} onClick={() => void s.submit(() => setUserPinAction(userId, pin), () => { setPin(''); setMsg('PINを再設定しました（ロックも解除）。'); router.refresh(); })}>再設定</button>
      <SuccessBanner message={msg} />
      <ErrorBanner message={s.error} />
    </div>
  );
}

export function UsersAdmin({ stores, users, meId }: { stores: { id: string; name: string }[]; users: U[]; meId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'pin' | 'email'>('pin');
  const [loginName, setLoginName] = useState('');
  const [pin, setPin] = useState('');
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
        const memberships = Object.entries(roles).filter(([, r]) => r).map(([storeId, role]) => ({ storeId, role: role as Role }));
        void inv.submit(
          () => (mode === 'pin'
            ? inviteUserAction({ loginName, pin, displayName: loginName, memberships })
            : inviteUserAction({ email, password, displayName: name, memberships })),
          () => {
            setOk(`${mode === 'pin' ? loginName : email} を登録しました。${mode === 'pin' ? 'PIN' : '初期パスワード'}を本人に安全な方法で伝えてください。`);
            setLoginName(''); setPin(''); setEmail(''); setName(''); setPassword(''); setRoles({});
            router.refresh();
          },
        );
      }}>
        <h2 className="font-bold">ユーザーを招待（アカウント発行）</h2>
        <div className="flex gap-2" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'pin'} className={mode === 'pin' ? 'btn-primary' : 'btn-sub'} onClick={() => setMode('pin')}>担当者（名前 + PIN）</button>
          <button type="button" role="tab" aria-selected={mode === 'email'} className={mode === 'email' ? 'btn-primary' : 'btn-sub'} onClick={() => setMode('email')}>管理者など（メール + パスワード）</button>
        </div>
        {mode === 'pin' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="名前（ログイン名・表示名）" htmlFor="inv-loginName" error={inv.fields.loginName} required><input id="inv-loginName" className="input" value={loginName} onChange={(e) => setLoginName(e.target.value)} autoComplete="off" /></Field>
            <Field label="PIN（4〜8桁の数字）" htmlFor="inv-pin" error={inv.fields.pin} required><input id="inv-pin" inputMode="numeric" className="input" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" /></Field>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="メールアドレス" htmlFor="inv-email" error={inv.fields.email} required><input id="inv-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
            <Field label="表示名" htmlFor="inv-name" error={inv.fields.displayName} required><input id="inv-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="初期パスワード（10文字以上）" htmlFor="inv-pw" error={inv.fields.password} required><input id="inv-pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
          </div>
        )}
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
                  <span className="font-bold">{u.display_name}</span>{' '}
                  <span className="text-sm text-slate-600">{u.login_name ? `名前ログイン（PIN）` : u.email}</span>
                  {u.is_system_admin ? <span className="badge ml-2 border-slate-800 bg-slate-800 text-white">システム管理者</span> : null}
                  {!u.is_active ? <span className="badge ml-2 border-red-300 bg-red-50 text-red-700">無効</span> : null}
                </div>
                {u.id !== meId ? (
                  <button type="button" className="btn-sub" disabled={row.busy} onClick={() => void row.submit(() => setUserActiveAction(u.id, !u.is_active), () => router.refresh())}>{u.is_active ? '無効にする' : '有効にする'}</button>
                ) : null}
              </div>
              {u.login_name ? <PinReset userId={u.id} /> : null}
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
