'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { voidPostAction } from '@/app/actions';
import { ErrorBanner, Field, useSubmitter } from './forms';

export function VoidPostButton({ storeKey, postId, base }: { storeKey: string; postId: string; base: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, fields, submit } = useSubmitter();
  if (!open) return <button type="button" className="btn-danger" onClick={() => setOpen(true)}>この投稿を取り消す（誤登録）</button>;
  return (
    <div className="card space-y-2 border-red-200">
      <p className="text-sm">
        <b>登録ミスの取消専用</b>です。取り消すと件数・素材の使用数から除外されます。SNS側で後から削除・非公開になった投稿は取り消さず、「編集」の公開状態メモに記録してください（実績は残ります）。
      </p>
      <Field label="取消の理由" htmlFor="vp-reason" error={fields.reason ?? fields._}>
        <input id="vp-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorBanner message={error} />
      <div className="flex gap-2">
        <button type="button" className="btn-danger" disabled={busy} onClick={() => {
          if (!window.confirm('この投稿を誤登録として取り消します。よろしいですか？')) return;
          void submit(() => voidPostAction(storeKey, postId, reason), () => { router.push(`${base}/posts`); router.refresh(); });
        }}>{busy ? '取消中…' : '取り消す'}</button>
        <button type="button" className="btn-sub" disabled={busy} onClick={() => setOpen(false)}>キャンセル</button>
      </div>
    </div>
  );
}
