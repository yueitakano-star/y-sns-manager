'use client';

import { useState } from 'react';
import { generateCaptionAction } from '@/app/actions';
import type { CaptionCandidate } from '@/lib/ai';
import type { Platform } from '@/lib/constants';
import { ErrorBanner, useSubmitter } from './forms';

const TONES = [
  { v: 'casual', l: 'カジュアル' },
  { v: 'energetic', l: '元気・明るい' },
  { v: 'elegant', l: '上品・落ち着き' },
  { v: 'stylish', l: 'おしゃれ' },
  { v: 'notice', l: 'お知らせ' },
];
const LENGTHS = [
  { v: 'short', l: '短め' },
  { v: 'normal', l: 'ふつう' },
  { v: 'long', l: '長め' },
];

/** Geminiで文章案を作り、確認してから採用する。採用するまでキャプション欄は変わらない */
export function AiCaptionAssist({ storeKey, ready, platform, category, title, castNames, currentCaption, onApply }: {
  storeKey: string;
  ready: boolean;
  platform: Platform;
  category: string;
  title: string;
  castNames: string[];
  currentCaption: string;
  onApply: (caption: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [tone, setTone] = useState('casual');
  const [length, setLength] = useState('normal');
  const [hashtags, setHashtags] = useState(true);
  const [cands, setCands] = useState<CaptionCandidate[]>([]);
  const [applied, setApplied] = useState<number | null>(null);
  const { busy, error, fields, submit } = useSubmitter();

  if (!ready) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600" data-testid="ai-unavailable">
        AIでキャプションを作る機能は未設定です（環境変数 GEMINI_API_KEY を設定して再デプロイすると使えます）。
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn-post" onClick={() => { setOpen(true); if (!draft) setDraft(currentCaption); }} data-testid="ai-open">
        ✨ AIでキャプションを作る・整える
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border-2 border-post-100 bg-post-50/40 p-3" data-testid="ai-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-post-700">✨ AIでキャプションを作る（Gemini）</p>
        <button type="button" className="text-sm underline" onClick={() => setOpen(false)}>閉じる</button>
      </div>
      <div>
        <label className="label" htmlFor="ai-draft">元になる文章（ざっくりでOK）</label>
        <textarea id="ai-draft" rows={4} className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="例: 新メニューのカルビが出ました。アスカが紹介します。土日はご予約がおすすめ" />
        {fields.draft ? <p role="alert" className="mt-1 text-sm font-medium text-red-700">{fields.draft}</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">文体
          <select className="input mt-1 font-normal" value={tone} onChange={(e) => setTone(e.target.value)}>{TONES.map((t) => (<option key={t.v} value={t.v}>{t.l}</option>))}</select>
        </label>
        <label className="text-sm font-semibold">長さ
          <select className="input mt-1 font-normal" value={length} onChange={(e) => setLength(e.target.value)}>{LENGTHS.map((t) => (<option key={t.v} value={t.v}>{t.l}</option>))}</select>
        </label>
        <label className="flex min-h-11 items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-5" checked={hashtags} onChange={(e) => setHashtags(e.target.checked)} />ハッシュタグも付ける</label>
      </div>
      <p className="text-xs text-slate-600">送るのは、ここに入れた文章・店舗名・投稿先・タイトル・出演者の表示名だけです（写真や動画は送りません）。個人情報や連絡先は書かないでください。</p>
      <button
        type="button"
        className="btn-post"
        disabled={busy}
        data-testid="ai-generate"
        onClick={() => {
          setApplied(null);
          void submit(
            () => generateCaptionAction(storeKey, { platform, category, title, castNames, draft, tone, length, hashtags }),
            (d) => setCands(d),
          );
        }}
      >
        {busy ? 'AIが作成中…（数秒かかります）' : cands.length ? 'もう一度作る' : 'キャプション案を作る'}
      </button>
      <ErrorBanner message={error} />
      {cands.length ? (
        <ul className="space-y-2" data-testid="ai-candidates">
          {cands.map((c, i) => (
            <li key={i} className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="mb-1 text-xs font-bold text-post-700">案{i + 1}｜{c.label}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.caption}</p>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" className="btn-sub !min-h-9" onClick={() => { onApply(c.caption); setApplied(i); }} data-testid={`ai-apply-${i}`}>この案を採用（キャプション欄に入れる）</button>
                {applied === i ? <span role="status" className="text-sm text-emerald-700">キャプション欄に入れました。下で確認・修正できます</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-slate-500">AIの文章は事実と違うことがあります。料金・日時・名前などは、必ず確認してから投稿してください。</p>
    </div>
  );
}

const LIMIT: Record<Platform, number> = { instagram: 2200, tiktok: 2200, other: 5000 };

/** 仕上がりの確認用プレビュー（文字数・ハッシュタグ数・Instagramの「続きを読む」位置の目安） */
export function CaptionPreview({ platform, caption, title }: { platform: Platform; caption: string; title: string }) {
  const tags = (caption.match(/[#＃][^\s#＃]+/g) ?? []).length;
  const over = caption.length > LIMIT[platform];
  const fold = platform === 'instagram' && caption.length > 125 ? caption.slice(0, 125) : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="caption-preview">
      <p className="mb-1 text-xs font-bold text-slate-600">仕上がりプレビュー（{platform === 'instagram' ? 'Instagram' : platform === 'tiktok' ? 'TikTok' : 'SNS'}）</p>
      {caption ? (
        <div className="rounded-lg bg-slate-50 p-3 text-sm leading-relaxed">
          {title ? <p className="mb-1 font-bold">{title}</p> : null}
          {fold ? (
            <p className="whitespace-pre-wrap">{fold}<span className="text-slate-400">… 続きを読む</span></p>
          ) : (
            <p className="whitespace-pre-wrap">{caption}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">キャプションを入力すると、ここに仕上がりが表示されます。</p>
      )}
      <p className={`mt-1 text-xs ${over ? 'font-bold text-red-700' : 'text-slate-500'}`}>
        {caption.length}文字（目安の上限 {LIMIT[platform]}）／ ハッシュタグ {tags}個{platform === 'instagram' && tags > 30 ? '（Instagramは30個まで）' : ''}
        {fold ? ' ／ 投稿一覧では最初の約125文字までが表示されます' : ''}
      </p>
    </div>
  );
}
