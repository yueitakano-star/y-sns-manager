'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateItemAction } from '@/app/actions';
import { MATERIAL_STATES, MATERIAL_STATE_LABEL, type MaterialStatus } from '@/lib/constants';
import { withDownload } from '@/lib/download';
import { ErrorBanner, useSubmitter } from './forms';
import { ShareButton } from './ShareButton';

export interface GalleryItem {
  id: string;
  code: string;
  status: MaterialStatus;
  memo: string;
  published_count: number;
  scheduled_count: number;
  cast_names: string[];
  thumb: { url: string; type: string } | null;
  files: { id: string; file_name: string; content_type: string; url: string | null }[];
}

const DOT: Record<MaterialStatus, string> = { ready: 'bg-emerald-500', editing: 'bg-amber-400', captured: 'bg-slate-400', unusable: 'bg-red-500' };

/** iPhoneの「写真」のように、写真・動画だけをすき間なく並べる。選択モードではタップで選択、通常はタップで拡大 */
export function ItemGallery({ items, selected, selectMode, onTile }: { items: GalleryItem[]; selected: string[]; selectMode: boolean; onTile: (index: number) => void }) {
  return (
    <ul className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-xl sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8" data-testid="gallery">
      {items.map((it, i) => {
        const on = selected.includes(it.id);
        return (
          <li key={it.id} className="relative aspect-square bg-slate-200">
            <button type="button" onClick={() => onTile(i)} className="absolute inset-0 block size-full" aria-label={`${it.code}${selectMode ? (on ? ' の選択を外す' : ' を選択') : ' を開く'}`} aria-pressed={selectMode ? on : undefined} data-testid="gallery-tile">
              {it.thumb?.type.startsWith('video/') ? (
                <video src={`${it.thumb.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
              ) : it.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.thumb.url} alt={it.code} loading="lazy" className="size-full object-cover" />
              ) : (
                <span className="flex size-full flex-col items-center justify-center gap-0.5 text-slate-500">
                  <span className="text-2xl" aria-hidden>▣</span>
                  <span className="px-1 text-center text-[10px] leading-tight">{it.code.split('-').slice(-1)[0]}<br />ファイルなし</span>
                </span>
              )}
              {it.status === 'unusable' ? <span className="absolute inset-0 bg-white/60" aria-hidden /> : null}
              {on ? <span className="absolute inset-0 bg-sky-500/25 ring-4 ring-inset ring-sky-500" aria-hidden /> : null}
            </button>
            {/* 左下: 番号 / 右下: 動画・複数枚 */}
            <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">{it.code.split('-').slice(-1)[0]}</span>
            {it.thumb?.type.startsWith('video/') ? <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/55 px-1 text-[10px] font-bold text-white">▶</span> : null}
            {it.files.length > 1 ? <span className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/55 px-1 text-[10px] font-bold text-white">+{it.files.length - 1}</span> : null}
            {/* 右上: 状態ドット（色だけでなく✕✓✎でも区別）と使用済み */}
            <span className="pointer-events-none absolute right-0.5 top-0.5 flex items-center gap-0.5">
              {it.published_count > 0 ? <span className="rounded bg-post-600 px-1 text-[10px] font-bold text-white">使用済</span> : null}
              <span className={`flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white ${DOT[it.status]}`} title={MATERIAL_STATE_LABEL[it.status]} aria-label={MATERIAL_STATE_LABEL[it.status]}>
                {{ ready: '✓', editing: '✎', unusable: '✕', captured: '' }[it.status]}
              </span>
            </span>
            {selectMode ? (
              <span className={`pointer-events-none absolute left-0.5 top-0.5 flex size-6 items-center justify-center rounded-full border-2 text-xs font-bold ${on ? 'border-sky-500 bg-sky-500 text-white' : 'border-white bg-black/20 text-transparent'}`} aria-hidden>✓</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** 拡大表示: 大きく見て、左右で前後へ、状態の変更・保存・投稿登録ができる */
export function Viewer({ storeKey, base, items, index, editable, onClose, onIndex }: { storeKey: string; base: string; items: GalleryItem[]; index: number; editable: boolean; onClose: () => void; onIndex: (i: number) => void }) {
  const router = useRouter();
  const it = items[index];
  const [status, setStatus] = useState<MaterialStatus>(it.status);
  const { busy, error, submit } = useSubmitter();
  const touch = useRef<number | null>(null);
  const prev = useCallback(() => onIndex((index - 1 + items.length) % items.length), [index, items.length, onIndex]);
  const next = useCallback(() => onIndex((index + 1) % items.length), [index, items.length, onIndex]);

  useEffect(() => setStatus(it.status), [it.id, it.status]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', h);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, prev, next]);

  const file = it.files.find((f) => f.url) ?? null;
  return (
    <div role="dialog" aria-modal="true" aria-label={`${it.code} の拡大表示`} className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white" data-testid="viewer">
      <div className="flex items-center justify-between gap-2 p-3">
        <button type="button" className="rounded-lg bg-white/15 px-4 py-2 font-semibold" onClick={onClose}>✕ 閉じる</button>
        <p className="truncate text-sm font-semibold">{it.code}（{index + 1}/{items.length}）</p>
        <span className="w-20" />
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (touch.current == null) return; const dx = e.changedTouches[0].clientX - touch.current; touch.current = null; if (Math.abs(dx) > 60) (dx > 0 ? prev() : next()); }}>
        {file?.url ? (
          file.content_type.startsWith('video/') ? (
            <video key={file.id} src={file.url} controls playsInline className="max-h-full max-w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={file.id} src={file.url} alt={it.code} className="max-h-full max-w-full object-contain" />
          )
        ) : (
          <p className="text-slate-300">この素材にはファイルがありません（番号と状態のみ記録されています）</p>
        )}
        {items.length > 1 ? (
          <>
            <button type="button" onClick={prev} aria-label="前へ" className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-3 py-2 text-2xl">‹</button>
            <button type="button" onClick={next} aria-label="次へ" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-3 py-2 text-2xl">›</button>
          </>
        ) : null}
      </div>
      <div className="space-y-2 bg-black/70 p-3 text-sm">
        <p className="text-slate-300">{it.cast_names.length ? it.cast_names.join('、') : '店舗共通'}　{it.published_count > 0 ? `／ 投稿済み${it.published_count}回` : '／ 未使用'}{it.memo ? `／ ${it.memo}` : ''}</p>
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <>
              <select aria-label="状態" className="rounded-lg bg-white px-3 py-2 text-base text-slate-900" value={status} onChange={(e) => setStatus(e.target.value as MaterialStatus)}>
                {MATERIAL_STATES.map((s) => (<option key={s.key} value={s.key}>{s.name}</option>))}
              </select>
              <button type="button" className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold disabled:opacity-50" disabled={busy || status === it.status}
                onClick={() => void submit(() => updateItemAction(storeKey, it.id, { status, memo: it.memo, storageUrl: '' }), () => router.refresh())}>
                {busy ? '保存中…' : '状態を保存'}
              </button>
            </>
          ) : <span className="rounded-lg bg-white/15 px-3 py-2">{MATERIAL_STATE_LABEL[it.status]}</span>}
          {file?.url ? <a className="rounded-lg bg-white/15 px-4 py-2 font-semibold" href={withDownload(file.url, file.file_name)} download={file.file_name} data-testid="viewer-download">⬇ 保存</a> : null}
          {file?.url ? <ShareButton className="rounded-lg bg-white/15 px-4 py-2 font-semibold" files={[{ url: file.url, name: file.file_name, type: file.content_type }]} /> : null}
          {editable ? <Link className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold" href={`${base}/posts/new?item=${it.id}`}>この素材で投稿登録</Link> : null}
        </div>
        <ErrorBanner message={error} />
      </div>
    </div>
  );
}
