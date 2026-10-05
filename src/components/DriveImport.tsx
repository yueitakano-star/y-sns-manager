'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { importDriveItemsAction, previewDriveImportAction } from '@/app/actions';
import type { ImportEntry, ImportPreview } from '@/lib/domain/archive-import';
import { PURPOSES } from '@/lib/constants';
import { ErrorBanner, Field, useSubmitter } from './forms';

interface Row extends ImportEntry {
  checked: boolean;
  castIds: string[];
}

/** ドライブのフォルダを読み取って、確認してから過去素材置き場へまとめて登録する */
export function DriveImport({ storeKey, casts, base }: { storeKey: string; casts: { id: string; name: string }[]; base: string }) {
  const [folderUrl, setFolderUrl] = useState('');
  const [group, setGroup] = useState<'subfolders' | 'files'>('subfolders');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [purpose, setPurpose] = useState('');
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const read = useSubmitter();
  const imp = useSubmitter();
  const nameOf = (id: string) => casts.find((c) => c.id === id)?.name ?? '';

  const selected = rows.filter((r) => r.checked && !r.alreadyImported);
  const patch = (id: string, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const total = useMemo(() => rows.filter((r) => !r.alreadyImported).length, [rows]);

  return (
    <div className="space-y-4">
      <form
        className="card space-y-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          void read.submit(
            () => previewDriveImportAction(storeKey, { folderUrl, group }),
            (p) => {
              setPreview(p);
              setRows(p.entries.map((en) => ({ ...en, checked: !en.alreadyImported, castIds: en.suggestedCastIds })));
            },
          );
        }}
      >
        <Field label="Googleドライブのフォルダの URL" htmlFor="di-url" required error={read.fields.folderUrl} hint="ドライブでフォルダを開いたときのURLです。事前にそのフォルダを、案内のサービスアカウントに「閲覧者」で共有しておきます。">
          <input id="di-url" inputMode="url" className="input" value={folderUrl} onChange={(e) => setFolderUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
        </Field>
        <fieldset>
          <legend className="label">まとめ方</legend>
          <div className="flex flex-wrap gap-2">
            {([['subfolders', 'サブフォルダごとに1件（撮影ごとのフォルダ向け）'], ['files', 'ファイルごとに1件（最大500件・3階層まで）']] as const).map(([v, l]) => (
              <label key={v} className="btn-sub cursor-pointer justify-start has-[:checked]:!border-mat-600 has-[:checked]:!bg-mat-50 has-[:checked]:font-bold">
                <input type="radio" name="group" className="size-5" checked={group === v} onChange={() => setGroup(v)} />{l}
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorBanner message={read.error} />
        <button type="submit" className="btn-mat" disabled={read.busy} data-testid="di-read">{read.busy ? '読み取り中…（数秒〜数十秒）' : 'フォルダを読み取る'}</button>
      </form>

      {preview ? (
        <section className="space-y-3" data-testid="di-preview">
          <div className="card text-sm">
            フォルダ「<b>{preview.rootName}</b>」から <b>{rows.length}</b> 件を読み取りました（取り込み済み {rows.length - total} 件）。
            {preview.truncated ? <span className="ml-1 font-bold text-amber-800">※ 件数が多いため一部のみです。フォルダを分けて取り込んでください。</span> : null}
            <span className="block text-xs text-slate-500">ファイル名・フォルダ名にキャスト名が含まれていれば、出演キャストを自動で推定しています。違うものは行ごとに直せます。</span>
          </div>
          <div className="card flex flex-wrap items-end gap-3">
            <button type="button" className="btn-sub" onClick={() => setRows((p) => p.map((r) => ({ ...r, checked: !r.alreadyImported && selected.length < total })))}>{selected.length < total ? 'すべて選択' : 'すべて解除'}</button>
            <label className="text-sm font-semibold">用途（一括）
              <select className="input mt-1 font-normal" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="">未設定</option>
                {PURPOSES.map((p) => (<option key={p.key} value={p.key}>{p.name}</option>))}
              </select>
            </label>
            <label className="text-sm font-semibold">選択中の出演キャストを一括設定
              <select className="input mt-1 font-normal" value="" onChange={(e) => { const v = e.target.value; if (!v) return; setRows((p) => p.map((r) => (r.checked && !r.alreadyImported ? { ...r, castIds: v === '__none' ? [] : [v] } : r))); }}>
                <option value="">選んで適用…</option>
                <option value="__none">店舗共通（キャストなし）</option>
                {casts.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </label>
          </div>
          <ul className="space-y-2" data-testid="di-rows">
            {rows.map((r) => (
              <li key={r.id} className={`card !p-3 ${r.alreadyImported ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-2 size-5" checked={r.checked && !r.alreadyImported} disabled={r.alreadyImported} onChange={(e) => patch(r.id, { checked: e.target.checked })} aria-label={`${r.title} を取り込む`} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                      <span>{r.kind === 'folder' ? '📁 フォルダ' : '📄 ファイル'}</span>
                      {r.shotOn ? <span>{r.shotOn}</span> : null}
                      {r.alreadyImported ? <span className="rounded bg-slate-200 px-1.5 font-bold text-slate-700">取り込み済み</span> : null}
                      <span className="truncate">{r.path}</span>
                    </div>
                    <input className="input" value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} aria-label="タイトル" disabled={r.alreadyImported} />
                    {!r.alreadyImported ? (
                      <select className="input" value={r.castIds.length === 1 ? r.castIds[0] : r.castIds.length === 0 ? '__none' : '__guess'} aria-label="出演キャスト"
                        onChange={(e) => patch(r.id, { castIds: e.target.value === '__none' ? [] : e.target.value === '__guess' ? r.suggestedCastIds : [e.target.value] })}>
                        {r.suggestedCastIds.length > 1 ? <option value="__guess">推定: {r.suggestedCastIds.map(nameOf).join('・')}</option> : null}
                        <option value="__none">店舗共通（キャストなし）</option>
                        {casts.map((c) => (<option key={c.id} value={c.id}>{c.name}{r.suggestedCastIds.includes(c.id) ? '（推定）' : ''}</option>))}
                      </select>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <ErrorBanner message={imp.error} />
          <div className="sticky bottom-16 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-white/90 p-2 backdrop-blur md:static md:bg-transparent md:p-0">
            <button
              type="button"
              className="btn-mat"
              disabled={imp.busy || selected.length === 0}
              data-testid="di-import"
              onClick={() => {
                void imp.submit(
                  () => importDriveItemsAction(storeKey, { items: selected.map((r) => ({ externalId: r.id, title: r.title, url: r.url, mimeType: r.mimeType, shotOn: r.shotOn, castIds: r.castIds, purpose: purpose || null })) }),
                  (d) => { setResult(d); setRows((p) => p.map((r) => (r.checked ? { ...r, alreadyImported: true, checked: false } : r))); },
                );
              }}
            >
              {imp.busy ? '取り込み中…' : `選択した${selected.length}件を取り込む`}
            </button>
            {result ? (
              <span role="status" className="text-sm font-semibold text-emerald-800" data-testid="di-result">
                {result.imported}件を取り込みました{result.skipped ? `（${result.skipped}件は取り込み済みのためスキップ）` : ''}。
                <Link href={`${base}/archive`} className="ml-2 underline">一覧を見る</Link>
              </span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
