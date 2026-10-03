'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveCastAction } from '@/app/actions';
import { ErrorBanner, Field, useSubmitter } from './forms';

export interface CastFormValue {
  displayName: string;
  furigana: string;
  sortOrder: string;
  memo: string;
  photoUrl: string;
  status: 'active' | 'inactive';
}

export function CastForm({ storeKey, castId, initial, cancelHref }: { storeKey: string; castId: string | null; initial?: CastFormValue; cancelHref: string }) {
  const router = useRouter();
  const [v, setV] = useState<CastFormValue>(initial ?? { displayName: '', furigana: '', sortOrder: '', memo: '', photoUrl: '', status: 'active' });
  const { busy, error, fields, submit } = useSubmitter();
  const set = <K extends keyof CastFormValue>(k: K, val: CastFormValue[K]) => setV((p) => ({ ...p, [k]: val }));
  const cls = (k: string) => `input ${fields[k] ? 'input-error' : ''}`;

  return (
    <form
      className="card max-w-xl space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit(
          () => saveCastAction(storeKey, castId, v),
          (d) => {
            router.push(`/s/${storeKey}/casts/${d.id}`);
            router.refresh();
          },
        );
      }}
    >
      <Field label="表示名" htmlFor="displayName" error={fields.displayName} required hint="本名・住所・誕生日などは入力しないでください。">
        <input id="displayName" className={cls('displayName')} value={v.displayName} onChange={(e) => set('displayName', e.target.value)} maxLength={60} autoComplete="off" />
      </Field>
      <Field label="ふりがな（任意）" htmlFor="furigana" error={fields.furigana}>
        <input id="furigana" className={cls('furigana')} value={v.furigana} onChange={(e) => set('furigana', e.target.value)} maxLength={60} />
      </Field>
      <Field label="在籍状態" htmlFor="status" error={fields.status} hint="非表示・退店にしても、過去の素材・回答・投稿は残ります。">
        <select id="status" className="input" value={v.status} onChange={(e) => set('status', e.target.value as 'active' | 'inactive')}>
          <option value="active">在籍</option>
          <option value="inactive">非表示・退店</option>
        </select>
      </Field>
      <Field label="並び順（任意・小さい数ほど先頭）" htmlFor="sortOrder" error={fields.sortOrder}>
        <input id="sortOrder" inputMode="numeric" className={cls('sortOrder')} value={v.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
      </Field>
      <Field label="写真URL（任意）" htmlFor="photoUrl" error={fields.photoUrl} hint="http/https のURLのみ。">
        <input id="photoUrl" inputMode="url" className={cls('photoUrl')} value={v.photoUrl} onChange={(e) => set('photoUrl', e.target.value)} />
      </Field>
      <Field label="メモ（任意）" htmlFor="memo" error={fields.memo}>
        <textarea id="memo" rows={3} className={cls('memo')} value={v.memo} onChange={(e) => set('memo', e.target.value)} />
      </Field>
      <ErrorBanner message={error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary flex-1 sm:flex-none" disabled={busy}>
          {busy ? '保存中…' : castId ? '変更を保存' : 'キャストを登録'}
        </button>
        <button type="button" className="btn-sub" onClick={() => router.push(cancelHref)} disabled={busy}>キャンセル</button>
      </div>
    </form>
  );
}
