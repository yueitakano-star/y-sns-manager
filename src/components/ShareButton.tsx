'use client';

import { useState } from 'react';

interface Src {
  url: string;
  name: string;
  type: string;
}

const MAX_FILES = 10;
const MAX_TOTAL = 80 * 1024 * 1024;

/**
 * スマホの共有メニュー(Web Share API)で、選択したファイルをChatGPT・Instagram・LINEなどのアプリへ送る。
 * 共有はユーザーのタップ直後でないと開けないため、「準備」→「共有メニューを開く」の2タップにしている。
 */
export function ShareButton({ files, className = 'btn-sub' }: { files: Src[]; className?: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unsupported'>('idle');
  const [ready, setReady] = useState<File[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  if (!files.length) return null;

  async function prepare() {
    setMsg(null);
    if (typeof navigator === 'undefined' || !('share' in navigator)) {
      setState('unsupported');
      setMsg('このブラウザは共有メニューに対応していません。スマホのSafari/Chromeで開くか、「保存」してからアプリに追加してください。');
      return;
    }
    if (files.length > MAX_FILES) {
      setMsg(`一度に共有できるのは${MAX_FILES}件までです（${files.length}件選択中）。`);
      return;
    }
    setState('loading');
    try {
      const out: File[] = [];
      let total = 0;
      for (const f of files) {
        const r = await fetch(f.url);
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        total += blob.size;
        if (total > MAX_TOTAL) throw new Error('size');
        out.push(new File([blob], f.name, { type: f.type || blob.type }));
      }
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && !nav.canShare({ files: out })) {
        setState('unsupported');
        setMsg('この端末ではファイルの共有に対応していません。「保存」してから各アプリで選んでください。');
        return;
      }
      setReady(out);
      setState('ready');
    } catch (e) {
      setState('idle');
      setMsg((e as Error).message === 'size' ? 'ファイルが大きすぎます（合計80MBまで）。枚数を減らしてください。' : 'ファイルの取得に失敗しました。通信状況を確認して、もう一度お試しください。');
    }
  }

  async function open() {
    try {
      await navigator.share({ files: ready });
      setState('idle');
      setReady([]);
    } catch (e) {
      // 利用者が共有メニューを閉じた場合は何もしない
      if ((e as DOMException).name !== 'AbortError') setMsg('共有メニューを開けませんでした。「保存」してから各アプリで選んでください。');
      setState('ready');
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      {state === 'ready' ? (
        <button type="button" className="btn-post" onClick={open} data-testid="share-open">📤 共有メニューを開く（{ready.length}件）</button>
      ) : (
        <button type="button" className={className} onClick={prepare} disabled={state === 'loading'} data-testid="share-prepare">
          {state === 'loading' ? '準備中…' : '📤 アプリに送る'}
        </button>
      )}
      {msg ? <span role="status" className="max-w-xs text-xs text-slate-600" data-testid="share-msg">{msg}</span> : null}
    </span>
  );
}
