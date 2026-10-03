'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { quickUploadAction } from '@/app/actions';
import { PURPOSES } from '@/lib/constants';
import { ErrorBanner, newRequestKey, useSubmitter } from './forms';
import { uploadOne } from './uploader';

/** かんたん投稿: 名前(キャスト)・備考・ファイルだけ送る。送ると素材として自動登録される */
export function QuickUpload({ storeKey, base, casts, storageReady }: { storeKey: string; base: string; casts: { id: string; name: string }[]; storageReady: boolean }) {
  const [castId, setCastId] = useState('');
  const [memo, setMemo] = useState('');
  const [purpose, setPurpose] = useState('sns');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<{ batchId: string; ok: number; failed: number }[] | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, fields, submit, setError, setFields } = useSubmitter();

  if (!storageReady) {
    return (
      <section className="card mb-4 border-slate-200 text-sm text-slate-600" data-testid="quick-unavailable">
        <h2 className="mb-1 font-bold text-slate-800">かんたん投稿（名前・備考・ファイルだけ）</h2>
        ファイルの保存先が未設定のため、まだ使えません（環境変数 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）。
      </section>
    );
  }

  const isVideo = (f: File) => f.type.startsWith('video/');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDone(null);
    setWarn(null);
    if (!files.length) {
      setFields({ files: 'ファイルを選んでください。' });
      setError('ファイルを選んでください。');
      return;
    }
    const images = files.filter((f) => !isVideo(f));
    const videos = files.filter(isVideo);
    void submit(
      () => quickUploadAction(storeKey, { requestKey, castId: castId || null, memo, purpose, images: images.length, videos: videos.length }),
      async (d) => {
        const results: { batchId: string; ok: number; failed: number }[] = [];
        let n = 0;
        for (const b of d.batches) {
          const list = b.kind === 'video' ? videos : images;
          let ok = 0;
          let failed = 0;
          for (let i = 0; i < list.length; i++) {
            n++;
            setProgress(`アップロード中… ${n}/${files.length}`);
            const m = await uploadOne(storeKey, b.itemIds[i], list[i]);
            if (m) { failed++; setWarn(m); } else ok++;
          }
          results.push({ batchId: b.batchId, ok, failed });
        }
        setProgress(null);
        setDone(results);
        if (results.every((r) => r.failed === 0)) {
          setFiles([]);
          setMemo('');
          if (input.current) input.current.value = '';
          setRequestKey(newRequestKey());
        }
      },
    );
  }

  const total = done?.reduce((a, r) => a + r.ok, 0) ?? 0;
  const failed = done?.reduce((a, r) => a + r.failed, 0) ?? 0;

  return (
    <section className="mb-5 rounded-2xl border-2 border-mat-600 bg-mat-50/50 p-4" data-testid="quick-upload">
      <h2 className="text-lg font-bold text-mat-700">かんたん投稿</h2>
      <p className="mb-3 text-sm text-slate-600">名前・備考・ファイルを選んで送るだけ。素材として自動で登録されます（種類や詳細はあとで整えられます）。</p>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <div>
          <label htmlFor="q-cast" className="label">名前（キャスト）</label>
          <select id="q-cast" className="input" value={castId} onChange={(e) => setCastId(e.target.value)}>
            <option value="">店舗共通・その他（キャストなし）</option>
            {casts.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </div>
        <fieldset>
          <legend className="label">用途</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="ファイルの用途">
            {PURPOSES.map((p) => (
              <label key={p.key} className="btn-sub flex-1 cursor-pointer has-[:checked]:!border-mat-600 has-[:checked]:!bg-mat-600 has-[:checked]:!text-white">
                <input type="radio" name="q-purpose" className="sr-only" checked={purpose === p.key} onChange={() => setPurpose(p.key)} />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="q-memo" className="label">備考（任意）</label>
          <textarea id="q-memo" rows={2} className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例: 9/10 撮影分、PR用" />
        </div>
        <div>
          <label htmlFor="q-files" className="label">ファイル（写真・動画、複数OK）</label>
          <input id="q-files" ref={input} type="file" accept="image/*,video/*" multiple className="input" data-testid="quick-files"
            onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setFields({}); setError(null); }} />
          {files.length ? <p className="mt-1 text-sm">{files.length}件を選択中（画像{files.filter((f) => !isVideo(f)).length}・動画{files.filter(isVideo).length}）</p> : null}
          {fields.files ? <p role="alert" className="mt-1 text-sm font-medium text-red-700">{fields.files}</p> : null}
        </div>
        <ErrorBanner message={error} />
        {progress ? <p role="status" className="rounded-lg border border-sky-300 bg-sky-50 p-2 text-sm">{progress}　（画面を閉じないでください）</p> : null}
        <button type="submit" className="btn-mat w-full text-lg sm:w-auto" disabled={busy || !!progress} data-testid="quick-submit">
          {busy || progress ? '送信中…' : '送信する'}
        </button>
      </form>
      {done ? (
        <div role="status" className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="quick-done">
          {total}件を送信しました。{failed ? <b className="text-red-700">（{failed}件は失敗しました。「素材を開く」から「＋ ファイルを追加」でやり直してください）</b> : null}
          <span className="ml-2">{done.map((r) => (<Link key={r.batchId} href={`${base}/materials/${r.batchId}`} className="mr-2 underline">素材を開く</Link>))}</span>
          {warn ? <p className="mt-1 text-red-700">{warn}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
