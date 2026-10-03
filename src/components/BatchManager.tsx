'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  addItemsAction,
  createDerivedAction,
  markAllAnsweredAction,
  setAnswerAction,
  updateBatchAction,
  updateItemAction,
  voidBatchAction,
  voidItemsAction,
} from '@/app/actions';
import { ANSWER_LABEL, MATERIAL_STATES, PURPOSES, type AnswerStatus, type MaterialStatus } from '@/lib/constants';
import { removeFileAction } from '@/app/actions';
import { ErrorBanner, Field, SuccessBanner, toNum, useSubmitter } from './forms';
import { uploadOne } from './uploader';

export function BatchEditForm({ storeKey, batchId, initial, today, showOtherLabel }: { storeKey: string; batchId: string; initial: { title: string; shotOn: string; status: MaterialStatus; storageUrl: string; memo: string; otherLabel: string; purpose: string }; today: string; showOtherLabel: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ ...initial, applyStatusToItems: false });
  const { busy, error, fields, submit } = useSubmitter();
  const [saved, setSaved] = useState<string | null>(null);
  const cls = (k: string) => `input ${fields[k] ? 'input-error' : ''}`;
  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button type="button" className="btn-sub" onClick={() => { setOpen(true); setSaved(null); }}>グループ情報を編集</button>
        <SuccessBanner message={saved} />
      </div>
    );
  }
  return (
    <form
      className="card space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit(() => updateBatchAction(storeKey, batchId, v), () => { setOpen(false); setSaved('保存しました。'); router.refresh(); });
      }}
    >
      <Field label="タイトル" htmlFor="b-title" required error={fields.title}><input id="b-title" className={cls('title')} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
      {showOtherLabel ? <Field label="内容名" htmlFor="b-other" required error={fields.otherLabel}><input id="b-other" className={cls('otherLabel')} value={v.otherLabel} onChange={(e) => setV({ ...v, otherLabel: e.target.value })} /></Field> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="撮影・作成日" htmlFor="b-shot" required error={fields.shotOn}><input id="b-shot" type="date" max={today} className={cls('shotOn')} value={v.shotOn} onChange={(e) => setV({ ...v, shotOn: e.target.value })} /></Field>
        <Field label="作業状態" htmlFor="b-status" error={fields.status}>
          <select id="b-status" className="input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as MaterialStatus })}>
            {MATERIAL_STATES.map((s) => (<option key={s.key} value={s.key}>{s.name}</option>))}
          </select>
        </Field>
      </div>
      <Field label="ファイルの用途" htmlFor="b-purpose" error={fields.purpose}>
        <select id="b-purpose" className="input" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })}>
          <option value="">未設定</option>
          {PURPOSES.map((p) => (<option key={p.key} value={p.key}>{p.name}</option>))}
        </select>
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={v.applyStatusToItems} onChange={(e) => setV({ ...v, applyStatusToItems: e.target.checked })} />
        この状態をグループ内の全個別素材にも適用する
      </label>
      <Field label="保存場所URL（任意）" htmlFor="b-url" error={fields.storageUrl}><input id="b-url" inputMode="url" className={cls('storageUrl')} value={v.storageUrl} onChange={(e) => setV({ ...v, storageUrl: e.target.value })} /></Field>
      <Field label="メモ（任意）" htmlFor="b-memo" error={fields.memo}><textarea id="b-memo" rows={3} className={cls('memo')} value={v.memo} onChange={(e) => setV({ ...v, memo: e.target.value })} /></Field>
      <ErrorBanner message={error} />
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        <button type="button" className="btn-sub" disabled={busy} onClick={() => { setOpen(false); setV({ ...initial, applyStatusToItems: false }); }}>キャンセル</button>
      </div>
    </form>
  );
}

export interface ItemView {
  id: string;
  code: string;
  status: MaterialStatus;
  memo: string;
  published_count: number;
  scheduled_count: number;
  cast_names: string[];
  derived_from_code: string | null;
  files: { id: string; file_name: string; content_type: string; size_bytes: number; url: string | null }[];
}

function ItemRow({ storeKey, item, selected, onToggle, canUpload }: { storeKey: string; item: ItemView; selected: boolean; onToggle: () => void; canUpload: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(item.status);
  const [memo, setMemo] = useState(item.memo);
  const { busy, error, fields, submit } = useSubmitter();
  const [saved, setSaved] = useState(false);
  const dirty = status !== item.status || memo !== item.memo;
  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-5" checked={selected} onChange={onToggle} aria-label={`${item.code} を選択`} />
          <span className="font-mono text-sm font-bold">{item.code}</span>
        </label>
        {item.published_count > 0 ? <span className="badge border-emerald-300 bg-emerald-50 text-emerald-800">投稿済み {item.published_count}回</span> : <span className="badge border-slate-300 bg-slate-100 text-slate-700">未使用</span>}
        {item.scheduled_count > 0 ? <span className="badge border-sky-300 bg-sky-50 text-sky-800">予定 {item.scheduled_count}件に割当</span> : null}
        {item.derived_from_code ? <span className="badge border-amber-300 bg-amber-50 text-amber-800">派生: {item.derived_from_code}</span> : null}
        <span className="text-xs text-slate-500">{item.cast_names.length ? item.cast_names.join('、') : '店舗共通'}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select aria-label={`${item.code} の状態`} className="input !w-auto" value={status} onChange={(e) => { setStatus(e.target.value as MaterialStatus); setSaved(false); }}>
          {MATERIAL_STATES.map((s) => (<option key={s.key} value={s.key}>{s.name}</option>))}
        </select>
        <input aria-label={`${item.code} のメモ`} className="input !w-auto min-w-40 flex-1" placeholder="個別メモ（任意）" value={memo} onChange={(e) => { setMemo(e.target.value); setSaved(false); }} />
        <button type="button" className="btn-sub" disabled={busy || !dirty} onClick={() => void submit(() => updateItemAction(storeKey, item.id, { status, memo, storageUrl: '' }), () => { setSaved(true); router.refresh(); })}>
          {busy ? '保存中…' : '保存'}
        </button>
        {saved ? <span role="status" className="text-sm text-emerald-700">保存しました</span> : null}
      </div>
      {error ? <p role="alert" className="mt-1 text-sm text-red-700">{error}{fields.status ? ` ${fields.status}` : ''}</p> : null}
      <FileList storeKey={storeKey} item={item} canUpload={canUpload} />
    </li>
  );
}

export function ItemsManager({ storeKey, base, batchId, items, castOptions, editable, storageReady }: { storeKey: string; base: string; batchId: string; items: ItemView[]; castOptions: { id: string; name: string }[]; editable: boolean; storageReady: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [addCount, setAddCount] = useState('1');
  const [src, setSrc] = useState('');
  const [dCasts, setDCasts] = useState<string[]>([]);
  const v = useSubmitter();
  const a = useSubmitter();
  const d = useSubmitter();
  const toggle = (id: string) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const usedSel = items.filter((i) => sel.includes(i.id) && (i.published_count > 0 || i.scheduled_count > 0));
  const postHref = `${base}/posts/new?${sel.map((id) => `item=${id}`).join('&')}`;

  return (
    <div>
      {editable ? <BulkUpload storeKey={storeKey} items={items} storageReady={storageReady} /> : null}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" data-testid="items">
        {items.map((it) => (<ItemRow key={it.id} storeKey={storeKey} item={it} selected={sel.includes(it.id)} onToggle={() => toggle(it.id)} canUpload={editable && storageReady} />))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-sub" onClick={() => setSel(sel.length === items.length ? [] : items.map((i) => i.id))}>{sel.length === items.length ? '選択を解除' : 'すべて選択'}</button>
        {editable ? (
          sel.length ? <Link className="btn-post" href={postHref}>選択した{sel.length}点で投稿登録 →</Link> : <span className="text-sm text-slate-500">チェックした素材で投稿登録に進めます。</span>
        ) : null}
      </div>

      {editable ? (
        <div className="mt-4 space-y-3">
          <details className="card">
            <summary className="cursor-pointer text-sm font-bold">個別素材を追加する（番号は続きから採番）</summary>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="追加する数" htmlFor="addCount" error={a.fields.count}>
                <input id="addCount" inputMode="numeric" className="input !w-28" value={addCount} onChange={(e) => setAddCount(e.target.value)} />
              </Field>
              <button type="button" className="btn-mat" disabled={a.busy} onClick={() => void a.submit(() => addItemsAction(storeKey, batchId, toNum(addCount) as number), () => router.refresh())}>{a.busy ? '追加中…' : '追加'}</button>
            </div>
            <ErrorBanner message={a.error} />
          </details>

          <details className="card">
            <summary className="cursor-pointer text-sm font-bold">複数人が写る素材から、一部のキャストだけを切り出す（派生素材）</summary>
            <div className="mt-3 space-y-2">
              <select aria-label="元の素材" className="input" value={src} onChange={(e) => setSrc(e.target.value)}>
                <option value="">元の素材を選択</option>
                {items.map((i) => (<option key={i.id} value={i.id}>{i.code}（{i.cast_names.join('、') || '店舗共通'}）</option>))}
              </select>
              <div className="flex flex-wrap gap-2" role="group" aria-label="写っているキャスト">
                {castOptions.map((c) => (
                  <label key={c.id} className="btn-sub cursor-pointer has-[:checked]:!bg-mat-600 has-[:checked]:!text-white">
                    <input type="checkbox" className="sr-only" checked={dCasts.includes(c.id)} onChange={() => setDCasts((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} />
                    {c.name}
                  </label>
                ))}
              </div>
              <button type="button" className="btn-mat" disabled={d.busy || !src} onClick={() => void d.submit(() => createDerivedAction(storeKey, { sourceItemId: src, castIds: dCasts }), () => { setSrc(''); setDCasts([]); router.refresh(); })}>派生素材として追加</button>
              <ErrorBanner message={d.error} />
            </div>
          </details>

          <details className="card border-red-200">
            <summary className="cursor-pointer text-sm font-bold text-red-700">選択した個別素材を取り消す（誤登録・数量を減らす）</summary>
            <div className="mt-3 space-y-2">
              <p className="text-sm text-slate-600">上のチェックで取り消す素材を選びます。履歴は残り、集計からは除外されます。<b>投稿に紐付いた素材は取り消せません。</b></p>
              <p className="text-sm">選択中: <b>{sel.length}点</b>{usedSel.length ? <span className="ml-2 text-red-700">うち投稿に紐付き {usedSel.length}点（取消できません）</span> : null}</p>
              <Field label="取消の理由" htmlFor="void-reason" error={v.fields.reason ?? v.fields._}><input id="void-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: 誤って多く登録した" /></Field>
              <button type="button" className="btn-danger" disabled={v.busy || sel.length === 0}
                onClick={() => {
                  if (!window.confirm(`${sel.length}点の個別素材を取り消します。よろしいですか？`)) return;
                  void v.submit(() => voidItemsAction(storeKey, { itemIds: sel, reason }), () => { setSel([]); setReason(''); router.refresh(); });
                }}>{v.busy ? '取消中…' : '選択した素材を取り消す'}</button>
              <ErrorBanner message={v.error} />
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

export interface AnswerView {
  castId: string;
  castName: string;
  questionId: string;
  position: number;
  text: string;
  status: AnswerStatus;
  answeredOn: string | null;
}

function AnswerRow({ storeKey, sessionId, shotOn, today, a }: { storeKey: string; sessionId: string; shotOn: string; today: string; a: AnswerView }) {
  const router = useRouter();
  const [status, setStatus] = useState(a.status);
  const [on, setOn] = useState(a.answeredOn ?? shotOn);
  const { busy, error, submit } = useSubmitter();
  const [saved, setSaved] = useState(false);
  const dirty = status !== a.status || (status === 'answered' && on !== (a.answeredOn ?? shotOn));
  return (
    <li className="py-2">
      <p className="text-base font-semibold">Q{a.position}. {a.text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select aria-label={`Q${a.position} の回答状態`} className="input !w-auto" value={status} onChange={(e) => { setStatus(e.target.value as AnswerStatus); setSaved(false); }}>
          {(['unanswered', 'answered', 'passed'] as AnswerStatus[]).map((s) => (<option key={s} value={s}>{ANSWER_LABEL[s]}</option>))}
        </select>
        {status === 'answered' ? <input type="date" aria-label="回答日" className="input !w-auto" min={shotOn} max={today} value={on} onChange={(e) => { setOn(e.target.value); setSaved(false); }} /> : null}
        <button type="button" className="btn-sub" disabled={busy || !dirty}
          onClick={() => void submit(() => setAnswerAction(storeKey, { sessionId, castId: a.castId, questionId: a.questionId, status, answeredOn: status === 'answered' ? on : null }), () => { setSaved(true); router.refresh(); })}>
          {busy ? '保存中…' : '更新'}
        </button>
        {saved ? <span role="status" className="text-sm text-emerald-700">保存しました</span> : null}
      </div>
      {error ? <p role="alert" className="mt-1 text-sm text-red-700">{error}</p> : null}
    </li>
  );
}

export function AnswerEditor({ storeKey, sessionId, shotOn, today, answers, editable }: { storeKey: string; sessionId: string; shotOn: string; today: string; answers: AnswerView[]; editable: boolean }) {
  const router = useRouter();
  const byCast = [...new Set(answers.map((a) => a.castId))];
  const all = useSubmitter();
  return (
    <div className="space-y-3">
      {byCast.map((cid) => {
        const rows = answers.filter((a) => a.castId === cid);
        return (
          <div key={cid} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-bold">{rows[0].castName}（回答済み {rows.filter((r) => r.status === 'answered').length}/3）</h4>
              {editable ? (
                <button type="button" className="btn-sub !min-h-9 text-sm" disabled={all.busy} onClick={() => void all.submit(() => markAllAnsweredAction(storeKey, sessionId, cid, null), () => router.refresh())}>
                  3問とも回答済みにする
                </button>
              ) : null}
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((a) => (editable ? <AnswerRow key={a.questionId} storeKey={storeKey} sessionId={sessionId} shotOn={shotOn} today={today} a={a} /> : (
                <li key={a.questionId} className="py-2 text-sm">Q{a.position}. {a.text} — <b>{ANSWER_LABEL[a.status]}</b>{a.answeredOn ? `（${a.answeredOn}）` : ''}</li>
              )))}
            </ul>
          </div>
        );
      })}
      <ErrorBanner message={all.error} />
    </div>
  );
}

export function VoidBatchButton({ storeKey, batchId, base }: { storeKey: string; batchId: string; base: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, fields, submit } = useSubmitter();
  if (!open) return <button type="button" className="btn-danger" onClick={() => setOpen(true)}>この素材グループを取り消す（誤登録）</button>;
  return (
    <div className="card space-y-2 border-red-200">
      <p className="text-sm">誤登録として取り消すと、この素材と（インタビューなら）回答履歴が集計から除外されます。<b>投稿に使われている素材は取り消せません。</b></p>
      <Field label="取消の理由" htmlFor="vb-reason" error={fields.reason ?? fields._}><input id="vb-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <ErrorBanner message={error} />
      <div className="flex gap-2">
        <button type="button" className="btn-danger" disabled={busy} onClick={() => {
          if (!window.confirm('この素材グループを取り消します。よろしいですか？')) return;
          void submit(() => voidBatchAction(storeKey, batchId, reason), () => { router.push(`${base}/materials`); router.refresh(); });
        }}>{busy ? '取消中…' : '取り消す'}</button>
        <button type="button" className="btn-sub" disabled={busy} onClick={() => setOpen(false)}>キャンセル</button>
      </div>
    </div>
  );
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

function FileList({ storeKey, item, canUpload }: { storeKey: string; item: ItemView; canUpload: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rm = useSubmitter();
  if (!item.files.length && !canUpload) return null;
  return (
    <div className="mt-2 space-y-1" data-testid={`files-${item.code}`}>
      {item.files.length ? (
        <ul className="flex flex-wrap gap-2">
          {item.files.map((f) => (
            <li key={f.id} className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-xs">
              {f.url && f.content_type.startsWith('image/') ? (
                <a href={f.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={f.file_name} className="mb-1 h-20 w-20 rounded object-cover" loading="lazy" />
                </a>
              ) : null}
              {f.url ? <a className="block max-w-40 truncate underline" href={f.url} target="_blank" rel="noopener noreferrer">{f.file_name}</a> : <span>{f.file_name}</span>}
              <span className="text-slate-500">{fmtSize(f.size_bytes)}</span>
              {canUpload ? (
                <button type="button" className="ml-2 text-red-700 underline" disabled={rm.busy} onClick={() => { if (window.confirm('このファイルを一覧から外します。よろしいですか？')) void rm.submit(() => removeFileAction(storeKey, f.id), () => router.refresh()); }}>外す</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canUpload ? (
        <label className="btn-sub !min-h-9 cursor-pointer text-sm">
          {busy ? 'アップロード中…' : '＋ ファイルを追加'}
          <input type="file" accept="image/*,video/*" multiple className="sr-only" disabled={busy}
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (!files.length) return;
              setBusy(true); setErr(null);
              for (const f of files) { const m = await uploadOne(storeKey, item.id, f); if (m) { setErr(m); break; } }
              setBusy(false); router.refresh();
            }} />
        </label>
      ) : null}
      {err ? <p role="alert" className="text-sm text-red-700">{err}</p> : null}
      <ErrorBanner message={rm.error} />
    </div>
  );
}

/** まとめてアップロード: 選んだファイルを、ファイル未登録の個別素材へ番号順に割り当てる */
function BulkUpload({ storeKey, items, storageReady }: { storeKey: string; items: ItemView[]; storageReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const free = items.filter((i) => i.files.length === 0);
  if (!storageReady) return <p className="mb-2 text-xs text-slate-500">ファイルのアップロードは、保存先（Supabase Storage）の設定後に使えます。保存場所URLの記録は今でも使えます。</p>;
  return (
    <div className="mb-3 rounded-xl border border-mat-100 bg-mat-50/40 p-3">
      <label className="btn-mat cursor-pointer">
        {busy ? 'アップロード中…' : 'ファイルをまとめてアップロード'}
        <input type="file" accept="image/*,video/*" multiple className="sr-only" disabled={busy} data-testid="bulk-upload"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []).sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
            e.target.value = '';
            if (!files.length) return;
            if (files.length > free.length) { setErr(`ファイル${files.length}件に対して、ファイルのない個別素材が${free.length}点しかありません。先に「個別素材を追加」してください。`); return; }
            setBusy(true); setErr(null); setLog([]);
            for (let i = 0; i < files.length; i++) {
              const m = await uploadOne(storeKey, free[i].id, files[i]);
              if (m) { setErr(m); break; }
              setLog((p) => [...p, `${free[i].code} ← ${files[i].name}`]);
            }
            setBusy(false); router.refresh();
          }} />
      </label>
      <p className="mt-1 text-xs text-slate-600">選んだファイルを名前順に、ファイルのない個別素材（{free.length}点）へ割り当てます。個別に追加する場合は各素材の「＋ ファイルを追加」から。</p>
      {log.length ? <ul className="mt-1 text-xs text-emerald-800">{log.map((l) => <li key={l}>✓ {l}</li>)}</ul> : null}
      {err ? <p role="alert" className="mt-1 text-sm text-red-700">{err}</p> : null}
    </div>
  );
}
