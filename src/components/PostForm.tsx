'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPostsAction, updatePostAction } from '@/app/actions';
import {
  CATEGORY_BY_KEY,
  MEDIA_LABEL,
  MATERIAL_STATE_LABEL,
  PLATFORMS,
  POST_CATEGORIES,
  POST_STATES,
  setLabel,
  type CategoryKey,
  type MaterialStatus,
  type MediaKind,
  type Platform,
  type PostCategoryKey,
  type PostStatus,
} from '@/lib/constants';
import { toJstLocal } from '@/lib/jst';
import { ErrorBanner, Field, newRequestKey, useSubmitter } from './forms';

export interface PickItem {
  id: string;
  code: string;
  batch_title: string;
  category: CategoryKey;
  status: MaterialStatus;
  media_kind: MediaKind;
  cast_ids: string[];
  cast_names: string[];
  published_count: number;
  scheduled_count: number;
  set_label: string | null;
  set_id: string | null;
}
interface SetInfo { id: string; set_number: number; title: string }

interface TargetState {
  enabled: boolean;
  status: PostStatus;
  scheduledAt: string;
  publishedAt: string;
  url: string;
  format: string;
  publicStateNote: string;
}
const emptyTarget = (): TargetState => ({ enabled: false, status: 'draft', scheduledAt: '', publishedAt: '', url: '', format: '', publicStateNote: '' });

export interface PostInitial {
  category: PostCategoryKey;
  otherLabel: string;
  questionSetId: string;
  title: string;
  itemIds: string[];
  castIds: string[];
  caption: string;
  memo: string;
  platform: Platform;
  target: Omit<TargetState, 'enabled'>;
  unlinkedLegacy?: boolean;
}

const nowJst = () => toJstLocal(new Date().toISOString());

export function PostForm({ storeKey, storeName, casts, items, sets, mode, postId, initial, defaultItemIds, defaultCastId }: {
  storeKey: string;
  storeName: string;
  casts: { id: string; name: string; active: boolean }[];
  items: PickItem[];
  sets: SetInfo[];
  mode: 'create' | 'edit';
  postId?: string;
  initial?: PostInitial;
  defaultItemIds?: string[];
  defaultCastId?: string;
}) {
  const router = useRouter();
  const { busy, error, fields, submit, setError, setFields } = useSubmitter();
  const [requestKey] = useState(newRequestKey);
  const validDefaultItems = (defaultItemIds ?? []).filter((id) => items.some((i) => i.id === id));
  const [category, setCategory] = useState<PostCategoryKey>(initial?.category ?? 'self_pr');
  const [catTouched, setCatTouched] = useState(!!initial);
  const [otherLabel, setOtherLabel] = useState(initial?.otherLabel ?? '');
  const [questionSetId, setQuestionSetId] = useState(initial?.questionSetId ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [itemIds, setItemIds] = useState<string[]>(initial?.itemIds ?? validDefaultItems);
  const [castIds, setCastIds] = useState<string[]>(initial?.castIds ?? (defaultCastId && !validDefaultItems.length ? [defaultCastId] : []));
  const [castsTouched, setCastsTouched] = useState(!!initial || (!!defaultCastId && !validDefaultItems.length));
  const [commonOnly, setCommonOnly] = useState(false);
  const [caption, setCaption] = useState(initial?.caption ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [platform, setPlatform] = useState<Platform>(initial?.platform ?? 'instagram');
  const [targets, setTargets] = useState<Record<Platform, TargetState>>({
    instagram: { ...emptyTarget(), enabled: true },
    tiktok: emptyTarget(),
    other: emptyTarget(),
  });
  const [editTarget, setEditTarget] = useState<Omit<TargetState, 'enabled'>>(initial?.target ?? { status: 'draft', scheduledAt: '', publishedAt: '', url: '', format: '', publicStateNote: '' });

  // 素材ピッカーの絞り込み
  const [q, setQ] = useState('');
  const [fCast, setFCast] = useState('');
  const [fCat, setFCat] = useState('');
  const [onlyUnused, setOnlyUnused] = useState(false);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selected = itemIds.map((id) => itemById.get(id)).filter(Boolean) as PickItem[];
  const candidateCastIds = useMemo(() => [...new Set(selected.flatMap((i) => i.cast_ids))], [selected]);
  const candidateNames = candidateCastIds.map((id) => casts.find((c) => c.id === id)?.name).filter(Boolean);
  const usedSelected = selected.filter((i) => i.published_count > 0);

  const visible = items.filter((i) => {
    if (onlyUnused && i.published_count > 0) return false;
    if (fCat && i.category !== fCat) return false;
    if (fCast === 'common' ? i.cast_ids.length > 0 : fCast && !i.cast_ids.includes(fCast)) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!(`${i.code} ${i.batch_title} ${i.cast_names.join(' ')} ${i.set_label ?? ''}`.toLowerCase().includes(s))) return false;
    }
    return true;
  }).slice(0, 200);

  function toggleItem(id: string) {
    const next = itemIds.includes(id) ? itemIds.filter((x) => x !== id) : [...itemIds, id];
    setItemIds(next);
    const sel = next.map((x) => itemById.get(x)).filter(Boolean) as PickItem[];
    if (!castsTouched) setCastIds([...new Set(sel.flatMap((i) => i.cast_ids))]);
    if (!catTouched && sel[0]) {
      setCategory(CATEGORY_BY_KEY[sel[0].category].default_post_category);
      if (sel[0].category === 'interview' && sel[0].set_id) setQuestionSetId(sel[0].set_id);
    }
  }
  function toggleCast(id: string) {
    setCastsTouched(true);
    setCommonOnly(false);
    setCastIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  const setT = (p: Platform, patch: Partial<TargetState>) => setTargets((prev) => ({ ...prev, [p]: { ...prev[p], ...patch } }));

  const tFields = (p: Platform | null) => (k: string) => fields[`${p ?? 'target'}.${k}`] ?? fields[k];

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFields({});
    const base = { category, otherLabel, questionSetId: category === 'interview' && questionSetId ? questionSetId : null, title, itemIds, castIds: commonOnly ? [] : castIds, caption, memo };
    const mapT = (p: Platform, t: Omit<TargetState, 'enabled'>) => ({ platform: p, format: t.format, status: t.status, scheduledAt: t.scheduledAt || null, publishedAt: t.publishedAt || null, url: t.url, publicStateNote: t.publicStateNote });
    if (mode === 'edit' && postId) {
      void submit(() => updatePostAction(storeKey, postId, { ...base, target: mapT(platform, editTarget) }), () => { router.push(`/s/${storeKey}/posts/${postId}?saved=1`); router.refresh(); });
      return;
    }
    const enabled = (Object.keys(targets) as Platform[]).filter((p) => targets[p].enabled);
    if (!enabled.length) { setError('投稿先を1つ以上選択してください。'); setFields({ targets: '投稿先を選択してください。' }); return; }
    void submit(() => createPostsAction(storeKey, { requestKey, ...base, targets: enabled.map((p) => mapT(p, targets[p])) }), (d) => {
      router.push(`/s/${storeKey}/posts/${d.postIds[0]}?created=${d.postIds.length}`);
      router.refresh();
    });
  }

  const cls = (k: string) => `input ${fields[k] ? 'input-error' : ''}`;

  const targetFields = (key: Platform | null, t: Omit<TargetState, 'enabled'>, set: (patch: Partial<Omit<TargetState, 'enabled'>>) => void, label: string) => {
    const ef = tFields(key);
    const idp = key ?? 'edit';
    return (
      <div className="space-y-3 rounded-xl border border-post-100 bg-white p-3" data-testid={`target-${idp}`}>
        <p className="font-bold text-post-700">{label}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="状態" htmlFor={`${idp}-status`} error={ef('status')}>
            <select id={`${idp}-status`} className="input" value={t.status} onChange={(e) => set({ status: e.target.value as PostStatus })}>
              {POST_STATES.map((s) => (<option key={s.key} value={s.key}>{s.name}</option>))}
            </select>
          </Field>
          <Field label="投稿形式（任意）" htmlFor={`${idp}-format`} error={ef('format')}>
            <input id={`${idp}-format`} className="input" value={t.format} onChange={(e) => set({ format: e.target.value })} placeholder="リール／フィード／ストーリーズ など" />
          </Field>
        </div>
        {t.status === 'scheduled' || t.status === 'published' || t.scheduledAt ? (
          <Field label={`予定日時（日本時間）${t.status === 'scheduled' ? '' : '（任意）'}`} htmlFor={`${idp}-sched`} required={t.status === 'scheduled'} error={ef('scheduledAt')}>
            <input id={`${idp}-sched`} type="datetime-local" className={`input ${ef("scheduledAt") ? "input-error" : ""}`} value={t.scheduledAt} onChange={(e) => set({ scheduledAt: e.target.value })} />
          </Field>
        ) : null}
        {t.status === 'published' ? (
          <Field label="実際の投稿日時（日本時間）" htmlFor={`${idp}-pub`} required error={ef('publishedAt')} hint="過去の日時のみ。これから投稿する場合は状態を「投稿予定」にしてください。">
            <div className="flex gap-2">
              <input id={`${idp}-pub`} type="datetime-local" className={`input ${ef("publishedAt") ? "input-error" : ""}`} value={t.publishedAt} max={nowJst()} onChange={(e) => set({ publishedAt: e.target.value })} />
              <button type="button" className="btn-sub whitespace-nowrap" onClick={() => set({ publishedAt: nowJst() })}>今</button>
            </div>
          </Field>
        ) : null}
        <Field label="投稿URL（任意）" htmlFor={`${idp}-url`} error={ef('url')}>
          <input id={`${idp}-url`} inputMode="url" className="input" value={t.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
        </Field>
        {t.status === 'published' ? (
          <Field label="公開状態のメモ（任意）" htmlFor={`${idp}-note`} error={ef('publicStateNote')} hint="SNS側で後から削除・非公開にした場合はここに記録します（投稿した実績は残ります）。">
            <input id={`${idp}-note`} className="input" value={t.publicStateNote} onChange={(e) => set({ publicStateNote: e.target.value })} />
          </Field>
        ) : null}
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" data-testid="post-form">
      <div className="card border-post-100 bg-post-50/40 text-sm">登録先の店舗: <b>{storeName}</b>　／　登録するのは「SNS投稿」の記録です。実際の公開操作はこのサイトの外で行います。</div>
      {initial?.unlinkedLegacy ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">この投稿は素材未紐付けです。素材を選ぶと使用済みとして数えられます。</p> : null}

      <fieldset className="card space-y-3">
        <legend className="px-1 text-sm font-bold text-post-700">1. 投稿の系統</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {POST_CATEGORIES.map((c) => (
            <label key={c.key} className="btn-sub cursor-pointer justify-start has-[:checked]:!border-post-600 has-[:checked]:!bg-post-50 has-[:checked]:font-bold">
              <input type="radio" name="post-category" className="size-5" checked={category === c.key} onChange={() => { setCategory(c.key); setCatTouched(true); }} />
              {c.name}
            </label>
          ))}
        </div>
        {category === 'other' ? (
          <Field label="内容名（イベント等）" htmlFor="otherLabel" required error={fields.otherLabel}>
            <input id="otherLabel" className={cls('otherLabel')} value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} />
          </Field>
        ) : null}
        {category === 'interview' ? (
          <Field label="質問セット" htmlFor="questionSetId" error={fields.questionSetId}>
            <select id="questionSetId" className="input" value={questionSetId} onChange={(e) => setQuestionSetId(e.target.value)}>
              <option value="">選択してください（任意）</option>
              {sets.map((s) => (<option key={s.id} value={s.id}>{setLabel(s.set_number, s.title)}</option>))}
            </select>
          </Field>
        ) : null}
        <Field label="タイトル" htmlFor="title" required error={fields.title}>
          <input id="title" className={cls('title')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 9/10 Aさん セルフPR" />
        </Field>
      </fieldset>

      <fieldset className="card space-y-3">
        <legend className="px-1 text-sm font-bold text-post-700">2. 使用する素材（複数選択可・任意）</legend>
        <p className="text-xs text-slate-500">素材を選ばずに、過去の投稿などを「素材未紐付け」として記録することもできます。その場合、素材の使用数には数えません。</p>
        {selected.length ? (
          <ul className="flex flex-wrap gap-1.5" data-testid="selected-items">
            {selected.map((i) => (
              <li key={i.id}>
                <button type="button" className="badge border-mat-600 bg-mat-50 text-mat-700" onClick={() => toggleItem(i.id)} aria-label={`${i.code} の選択を外す`}>{i.code} ✕</button>
              </li>
            ))}
          </ul>
        ) : null}
        {usedSelected.length ? (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900" data-testid="reuse-notice">
            過去に投稿済みの素材が含まれています（{usedSelected.map((i) => `${i.code}：${i.published_count}回`).join('、')}）。再投稿として登録できます。
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <input className="input min-w-40 flex-1" placeholder="素材番号・タイトル・キャストで検索" aria-label="素材を検索" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="キャストで絞る" className="input !w-auto" value={fCast} onChange={(e) => setFCast(e.target.value)}>
            <option value="">全キャスト</option>
            <option value="common">店舗共通</option>
            {casts.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <select aria-label="種類で絞る" className="input !w-auto" value={fCat} onChange={(e) => setFCat(e.target.value)}>
            <option value="">全種類</option>
            {Object.values(CATEGORY_BY_KEY).map((c) => (<option key={c.key} value={c.key}>{c.name}</option>))}
          </select>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} />未使用のみ</label>
        </div>
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white" data-testid="picker">
          {visible.length === 0 ? <li className="p-3 text-sm text-slate-500">該当する素材がありません。</li> : null}
          {visible.map((i) => (
            <li key={i.id}>
              <label className="flex min-h-12 cursor-pointer items-start gap-3 p-2.5">
                <input type="checkbox" className="mt-1 size-5" checked={itemIds.includes(i.id)} onChange={() => toggleItem(i.id)} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-mono font-semibold">{i.code}</span>
                  <span className="ml-2 text-xs text-slate-500">{MEDIA_LABEL[i.media_kind]}・{MATERIAL_STATE_LABEL[i.status]}</span>
                  <span className="block truncate text-slate-600">{i.batch_title}{i.set_label ? ` ・ ${i.set_label}` : ''} ・ {i.cast_names.join('、') || '店舗共通'}</span>
                </span>
                {i.published_count > 0 ? <span className="badge border-amber-300 bg-amber-50 text-amber-800">使用済み{i.published_count}回</span> : <span className="badge border-slate-300 bg-slate-100 text-slate-600">未使用</span>}
                {i.scheduled_count > 0 ? <span className="badge border-sky-300 bg-sky-50 text-sky-800">予定あり</span> : null}
              </label>
            </li>
          ))}
        </ul>
        {fields.itemIds ? <p role="alert" className="text-sm font-medium text-red-700">{fields.itemIds}</p> : null}
      </fieldset>

      <fieldset className="card space-y-3">
        <legend className="px-1 text-sm font-bold text-post-700">3. 出演キャスト（実際に写っている人を確認）</legend>
        {candidateNames.length ? <p className="text-sm text-slate-600">選択した素材の出演候補: <b>{candidateNames.join('、')}</b>　※ 一人だけを切り出した投稿の場合は、素材詳細で「派生素材」を登録してから選んでください。</p> : null}
        <div className="flex flex-wrap gap-2" role="group" aria-label="出演キャスト">
          {casts.map((c) => (
            <label key={c.id} className={`btn-sub cursor-pointer has-[:checked]:!border-post-600 has-[:checked]:!bg-post-600 has-[:checked]:!text-white ${c.active ? '' : 'opacity-70'}`}>
              <input type="checkbox" className="sr-only" checked={castIds.includes(c.id) && !commonOnly} onChange={() => toggleCast(c.id)} />
              {c.name}{c.active ? '' : '（退店）'}
            </label>
          ))}
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={commonOnly} onChange={(e) => { setCommonOnly(e.target.checked); setCastsTouched(true); if (e.target.checked) setCastIds([]); }} />
          店舗共通（キャストなし）の投稿
        </label>
        {fields.castIds ? <p role="alert" className="text-sm font-medium text-red-700">{fields.castIds}</p> : null}
      </fieldset>

      <fieldset className="card space-y-3">
        <legend className="px-1 text-sm font-bold text-post-700">4. 投稿先と状態</legend>
        {mode === 'edit' ? (
          <>
            <Field label="投稿先" htmlFor="platform" error={fields.platform}>
              <select id="platform" className="input" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                {PLATFORMS.map((p) => (<option key={p.key} value={p.key}>{p.name}</option>))}
              </select>
            </Field>
            {targetFields(null, editTarget, (patch) => setEditTarget((p) => ({ ...p, ...patch })), '投稿の状態・日時')}
          </>
        ) : (
          <>
            <p className="text-xs text-slate-500">InstagramとTikTokの両方を選ぶと、投稿先ごとに別々の記録（状態・日時・URL）が作られます。</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="投稿先">
              {PLATFORMS.map((p) => (
                <label key={p.key} className="btn-sub cursor-pointer has-[:checked]:!border-post-600 has-[:checked]:!bg-post-600 has-[:checked]:!text-white">
                  <input type="checkbox" className="sr-only" checked={targets[p.key].enabled} onChange={(e) => setT(p.key, { enabled: e.target.checked })} />
                  {p.name}
                </label>
              ))}
            </div>
            {fields.targets ? <p role="alert" className="text-sm font-medium text-red-700">{fields.targets}</p> : null}
            {PLATFORMS.filter((p) => targets[p.key].enabled).map((p) => (
              <div key={p.key}>{targetFields(p.key, targets[p.key], (patch) => setT(p.key, patch), `${p.name} の投稿`)}</div>
            ))}
          </>
        )}
      </fieldset>

      <fieldset className="card space-y-3">
        <legend className="px-1 text-sm font-bold text-post-700">5. キャプション・メモ（任意）</legend>
        <Field label="キャプション" htmlFor="caption" error={fields.caption}><textarea id="caption" rows={4} className={cls('caption')} value={caption} onChange={(e) => setCaption(e.target.value)} /></Field>
        <Field label="メモ" htmlFor="memo" error={fields.memo}><textarea id="memo" rows={2} className={cls('memo')} value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      </fieldset>

      <ErrorBanner message={error} />
      <div className="sticky bottom-16 z-10 -mx-1 flex gap-2 rounded-xl bg-white/90 p-2 backdrop-blur md:static md:bg-transparent md:p-0">
        <button type="submit" className="btn-post flex-1 sm:flex-none" disabled={busy} data-testid="submit-post">{busy ? '保存中…' : mode === 'edit' ? '変更を保存' : '投稿を登録する'}</button>
        <button type="button" className="btn-sub" onClick={() => router.back()} disabled={busy}>キャンセル</button>
      </div>
    </form>
  );
}
