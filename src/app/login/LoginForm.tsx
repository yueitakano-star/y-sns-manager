'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginAction } from '../actions';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await loginAction(email, password);
      if (r.ok) {
        router.push('/');
        router.refresh();
        return;
      }
      setError(r.message);
    } catch {
      setError('通信に失敗しました。ネットワークを確認してもう一度お試しください。');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label className="label" htmlFor="email">名前 または メールアドレス</label>
        <input id="email" name="email" type="text" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="password">PIN または パスワード</label>
        <input id="password" name="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error ? <p role="alert" data-testid="login-error" className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'ログイン中…' : 'ログイン'}
      </button>
    </form>
  );
}
