'use client';

import { useState } from 'react';

/** 投稿者コメントなどをワンタップでコピー */
export function CopyButton({ text, label = 'コピーする' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'ng'>('idle');
  return (
    <button
      type="button"
      className="btn-mat"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState('ok');
        } catch {
          setState('ng');
        }
        setTimeout(() => setState('idle'), 2500);
      }}
    >
      {state === 'ok' ? '✓ コピーしました' : state === 'ng' ? 'コピーできませんでした（長押しで選択してください）' : label}
    </button>
  );
}
