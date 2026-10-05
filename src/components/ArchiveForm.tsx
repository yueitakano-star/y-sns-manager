'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createArchiveAction, updateArchiveAction, voidArchiveAction } from '@/app/actions';
import { PURPOSES } from '@/lib/constants';
import { ErrorBanner, Field, newRequestKey, useSubmitter } from './forms';

export interface ArchiveFormValue {
  title: string;
  url: string;
  description: string;
  shotOn: string;
  purpose: string;
  castIds: string[];
}

export function ArchiveForm({ storeKey, linkId, initial, casts, today }: { storeKey: string; linkId: string | null; initial?: ArchiveFormValue; casts: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [v, setV] = useState<ArchiveFormValue>(initial ?? { title: '', url: '', description: '', shotOn: '', purpose: '', castIds: [] });
  const [requestKey] = useState(newRequestKey);
  const { busy, error, fields, submit } = useSubmitter();
  const set = <K extends keyof ArchiveFormValue>(k: K, val: ArchiveFormValue[K]) => setV((p) => ({ ...p, [k]: val }));
  const cls = (k: string) => `input ${fields[k] ? 'input-error' : ''}`;
  const back = `/s/${storeKey}/archive`;

  return (
    <form
      className="card max-w-2xl space-y-4"
      noValidate
      data-testid="archive-form"
      onSubmit={(e) => {
        e.preventDefault();
        const payload = { ...v, purpose: v.purpose || null, shotOn: v.shotOn || null };
        void submit(
          async () => {
            const r = linkId ? await updateArchiveAction(storeKey, linkId, payload) : await createArchiveAction(storeKey, { requestKey, ...payload });
            return r.ok ? ({ ok: true, data: undefined } as const) : r;
          },
          () => { router.push(`${back}?saved=1`); router.refresh(); },
        );
      }}
    >
      <Field label="タイトル" htmlFor="a-title" required error={fields.title} hint="例: 2025年 B-club 春の撮影まとめ">
        <input id="a-title" className={cls('title')} value={v.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="リンク（Googleドライブのフォルダ／ファイルのURL）" htmlFor="a-url" required error={fields.url} hint="ドライブで「共有」→ リンクをコピー。スタッフが開けるよう、共有設定（スタッフのGoogleアカウント）を確認してください。">
        <input id="a-url" inputMode="url" className={cls('url')} value={v.url} onChange={(e) => set('url', e.target.value)} placeholder="https://drive.google.com/..." />
      </Field>
      <fieldset>
        <legend className="label">出演キャスト（任意・複数可）</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="出演キャスト">
          {casts.map((c) => (
            <label key={c.id} className="btn-sub cursor-pointer has-[:checked]:!border-mat-600 has-[:checked]:!bg-mat-600 has-[:checked]:!text-white">
              <input type="checkbox" className="sr-only" checked={v.castIds.includes(c.id)} onChange={() => set('castIds', v.castIds.includes(c.id) ? v.castIds.filter((x) => x !== c.id) : [...v.castIds, c.id])} />
              {c.name}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">選ばなければ「店舗共通」として登録されます。</p>
        {fields.castIds ? <p role="alert" className="text-sm font-medium text-red-700">{fields.castIds}</p> : null}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="撮影・作成日（任意）" htmlFor="a-date" error={fields.shotOn}>
          <input id="a-date" type="date" max={today} className={cls('shotOn')} value={v.shotOn} onChange={(e) => set('shotOn', e.target.value)} />
        </Field>
        <Field label="用途（任意）" htmlFor="a-purpose" error={fields.purpose}>
          <select id="a-purpose" className="input" value={v.purpose} onChange={(e) => set('purpose', e.target.value)}>
            <option value="">未設定</option>
            {PURPOSES.map((p) => (<option key={p.key} value={p.key}>{p.name}</option>))}
          </select>
        </Field>
      </div>
      <Field label="メモ（任意）" htmlFor="a-desc" error={fields.description}>
        <textarea id="a-desc" rows={3} className={cls('description')} value={v.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <ErrorBanner message={error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-mat flex-1 sm:flex-none" disabled={busy} data-testid="archive-submit">{busy ? '保存中…' : linkId ? '変更を保存' : 'リンクを登録'}</button>
        <button type="button" className="btn-sub" disabled={busy} onClick={() => router.push(back)}>キャンセル</button>
      </div>
    </form>
  );
}

export function VoidArchiveButton({ storeKey, linkId }: { storeKey: string; linkId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, fields, submit } = useSubmitter();
  if (!open) return <button type="button" className="btn-danger" onClick={() => setOpen(true)}>このリンクを一覧から外す</button>;
  return (
    <div className="card space-y-2 border-red-200">
      <p className="text-sm">一覧から外すだけで、Googleドライブ上のファイルには何もしません。</p>
      <Field label="理由" htmlFor="va-reason" error={fields.reason ?? fields._}><input id="va-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: 重複登録" /></Field>
      <ErrorBanner message={error} />
      <div className="flex gap-2">
        <button type="button" className="btn-danger" disabled={busy} onClick={() => { if (!window.confirm('このリンクを一覧から外します。よろしいですか？')) return; void submit(() => voidArchiveAction(storeKey, linkId, reason), () => { router.push(`/s/${storeKey}/archive`); router.refresh(); }); }}>{busy ? '処理中…' : '外す'}</button>
        <button type="button" className="btn-sub" disabled={busy} onClick={() => setOpen(false)}>キャンセル</button>
      </div>
    </div>
  );
}
