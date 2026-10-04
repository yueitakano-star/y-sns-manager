'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createInterviewAction, createMaterialAction } from '@/app/actions';
import { CATEGORIES, CATEGORY_BY_KEY, MATERIAL_STATES, PURPOSES, MEDIA_LABEL, UNIT, setLabel, type AnswerStatus, type CategoryKey, type MaterialStatus, type MediaKind } from '@/lib/constants';
import { ErrorBanner, Field, newRequestKey, toNum, useSubmitter } from './forms';
import { uploadOne } from './uploader';

interface SetInfo {
  id: string;
  set_number: number;
  title: string;
  questions: { id: string; position: number; text: string }[];
}
interface CastOpt {
  id: string;
  name: string;
}
type Ans = { status: AnswerStatus; answeredOn: string };

export function MaterialForm({ storeKey, storeName, casts, sets, today, defaultCastId, defaultCategory, storageReady }: { storeKey: string; storeName: string; casts: CastOpt[]; sets: SetInfo[]; today: string; defaultCastId?: string; defaultCategory?: string; storageReady: boolean }) {
  const router = useRouter();
  const { busy, error, fields, submit, setError, setFields } = useSubmitter();
  const [requestKey] = useState(newRequestKey);
  const [category, setCategory] = useState<CategoryKey>((defaultCategory && defaultCategory in CATEGORY_BY_KEY ? defaultCategory : 'self_pr_image') as CategoryKey);
  const [otherLabel, setOtherLabel] = useState('');
  const [mediaKind, setMediaKind] = useState<MediaKind>(CATEGORY_BY_KEY[category].allowed_media_kinds[0]);
  const [quantity, setQuantity] = useState('1');
  const [castIds, setCastIds] = useState<string[]>(defaultCastId && casts.some((c) => c.id === defaultCastId) ? [defaultCastId] : []);
  const [common, setCommon] = useState(false);
  const [shotOn, setShotOn] = useState(today);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<MaterialStatus>('captured');
  const [storageUrl, setStorageUrl] = useState('');
  const [memo, setMemo] = useState('');
  const [purpose, setPurpose] = useState('sns');
  const [setId, setSetId] = useState('');
  const [takeNo, setTakeNo] = useState('');
  const [answers, setAnswers] = useState<Record<string, Ans>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  const cat = CATEGORY_BY_KEY[category];
  const isInterview = category === 'interview';
  const curSet = sets.find((s) => s.id === setId);
  const qtyNum = toNum(quantity);

  const castName = (id: string) => casts.find((c) => c.id === id)?.name ?? '';
  const ans = (cid: string, qid: string): Ans => answers[`${cid}:${qid}`] ?? { status: 'unanswered', answeredOn: '' };
  const setAns = (cid: string, qid: string, patch: Partial<Ans>) =>
    setAnswers((p) => ({ ...p, [`${cid}:${qid}`]: { ...ans(cid, qid), ...patch } }));

  function changeCategory(k: CategoryKey) {
    setCategory(k);
    setMediaKind(CATEGORY_BY_KEY[k].allowed_media_kinds[0]);
    setFields({});
    setError(null);
  }
  function toggleCast(id: string) {
    setCommon(false);
    setCastIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : isInterview ? [...p, id] : [...p, id]));
  }

  const preview = useMemo(() => {
    if (isInterview) return `動画素材 ${toNum(quantity) ?? 1}本（個別素材）を作成します。`;
    if (typeof qtyNum === 'number' && Number.isInteger(qtyNum) && qtyNum >= 1) return `${MEDIA_LABEL[mediaKind]}${qtyNum}${UNIT[mediaKind]}ぶんの個別素材を作成します（番号付きで1点ずつ投稿に選べます）。`;
    return null;
  }, [isInterview, quantity, qtyNum, mediaKind]);

  /** 登録した個別素材へ、選んだファイルを番号順にアップロードしてから素材詳細へ移動する */
  async function finish(d: { batchId: string; itemIds: string[] }) {
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress(`ファイルをアップロード中… ${i + 1}/${files.length}`);
      const msg = await uploadOne(storeKey, d.itemIds[i], files[i]);
      if (msg) failed++;
    }
    setProgress(null);
    router.push(`/s/${storeKey}/materials/${d.batchId}?created=1${failed ? `&upload_failed=${failed}` : ''}`);
    router.refresh();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isInterview && castIds.length === 0 && !common) {
      setFields({ castIds: '出演キャストを選ぶか、「店舗共通（キャストなし）」を選んでください。' });
      setError('出演キャストを選択してください。');
      return;
    }
    const count = isInterview ? (toNum(quantity) ?? 1) : typeof qtyNum === 'number' ? qtyNum : 0;
    if (files.length > count) {
      setFields({ files: `選んだファイル(${files.length}件)が、登録する数量(${count})より多いです。` });
      setError('ファイルの数が数量を超えています。');
      return;
    }
    if (isInterview) {
      if (!setId) { setFields({ setId: '質問セットを選択してください。' }); setError('質問セットを選択してください。'); return; }
      if (castIds.length === 0) { setFields({ castIds: '出演キャストを1人以上選択してください。' }); setError('出演キャストを選択してください。'); return; }
      const list = castIds.flatMap((cid) =>
        (curSet?.questions ?? []).map((q) => {
          const a = ans(cid, q.id);
          return { castId: cid, questionId: q.id, status: a.status, answeredOn: a.status === 'answered' ? a.answeredOn || shotOn : null };
        }),
      );
      void submit(
        () => createInterviewAction(storeKey, { requestKey, purpose, shotOn, setId, castIds, takeNo: toNum(takeNo) ?? null, videoCount: toNum(quantity) ?? 1, title: title || null, status, storageUrl, memo, answers: list }),
        (d) => finish(d),
      );
      return;
    }
    void submit(
      () => createMaterialAction(storeKey, { requestKey, purpose, category, otherLabel, mediaKind, quantity: toNum(quantity), castIds: common ? [] : castIds, shotOn, title, status, storageUrl, memo }),
      (d) => finish(d),
    );
  }

  const cls = (k: string) => `input ${fields[k] ? 'input-error' : ''}`;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" data-testid="material-form">
      <div className="card border-mat-100 bg-mat-50/40 text-sm">登録先の店舗: <b>{storeName}</b>　／　登録するのは「素材」です。ここで登録しても投稿件数は増えません。</div>

      <fieldset className="card space-y-3">
        <legend className="px-1 text-sm font-bold text-mat-700">1. 出演キャスト</legend>
        {casts.length === 0 ? (
          <p className="text-sm text-amber-800">在籍中のキャストがいません。先にキャストを登録してください（店舗共通の素材だけなら下の「店舗共通」で登録できます）。</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="出演キャスト">
            {casts.map((c) => (
              <label key={c.id} className="btn-sub cursor-pointer has-[:checked]:!border-mat-600 has-[:checked]:!bg-mat-600 has-[:checked]:!text-white">
                <input type="checkbox" className="sr-only" checked={castIds.includes(c.id)} onChange={() => toggleCast(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        )}
        {!isInterview ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={common} onChange={(e) => { setCommon(e.target.checked); if (e.target.checked) setCastIds([]); }} />
            店舗共通（キャストなし）の素材として登録
          </label>
        ) : null}
        {fields.castIds ? <p role="alert" className="text-sm font-medium text-red-700">{fields.castIds}</p> : null}
        <p className="text-xs text-slate-500">キャストは1人が基本です。複数人が写る素材は複数選択してください。</p>
      </fieldset>

      <fieldset className="card space-y-3">
        <legend className="px-1 text-sm font-bold text-mat-700">2. 素材の種類</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <label key={c.key} className="btn-sub cursor-pointer justify-start has-[:checked]:!border-mat-600 has-[:checked]:!bg-mat-50 has-[:checked]:font-bold">
              <input type="radio" name="category" className="size-5" checked={category === c.key} onChange={() => changeCategory(c.key)} />
              {c.name}
            </label>
          ))}
        </div>
        {category === 'other' ? (
          <Field label="内容名" htmlFor="otherLabel" required error={fields.otherLabel}>
            <input id="otherLabel" className={cls('otherLabel')} value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} />
          </Field>
        ) : null}
        {fields.category ? <p role="alert" className="text-sm font-medium text-red-700">{fields.category}</p> : null}
      </fieldset>

      {isInterview ? (
        <fieldset className="card space-y-3">
          <legend className="px-1 text-sm font-bold text-mat-700">3. 質問セットと回答</legend>
          <Field label="質問セット" htmlFor="setId" required error={fields.setId}>
            <select id="setId" className={cls('setId')} value={setId} onChange={(e) => setSetId(e.target.value)}>
              <option value="">選択してください</option>
              {sets.map((s) => (<option key={s.id} value={s.id}>{setLabel(s.set_number, s.title)}</option>))}
            </select>
          </Field>
          {curSet ? (
            <div className="rounded-xl border-2 border-mat-100 bg-white p-3" data-testid="question-readout">
              <p className="mb-1 text-sm font-bold text-mat-700">{setLabel(curSet.set_number, curSet.title)}</p>
              <ol className="space-y-2">
                {curSet.questions.map((q) => (<li key={q.id} className="text-xl font-bold leading-snug sm:text-2xl">Q{q.position}. {q.text}</li>))}
              </ol>
            </div>
          ) : null}
          <Field label="撮影回（空欄なら自動で次の回）" htmlFor="takeNo" error={fields.takeNo} hint="同じキャストが同じセットを再撮影すると撮影回が増えます。完了セット数は増えません。">
            <input id="takeNo" inputMode="numeric" className={cls('takeNo')} value={takeNo} onChange={(e) => setTakeNo(e.target.value)} placeholder="自動" />
          </Field>

          {curSet && castIds.length ? (
            <div className="space-y-4">
              <p className="text-sm font-bold">キャスト別の回答状況（既定は「未回答」。実際に答えた質問だけ選んでください）</p>
              {castIds.map((cid) => (
                <div key={cid} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-bold">{castName(cid)}</span>
                    <button type="button" className="btn-sub !min-h-9 text-sm" onClick={() => curSet.questions.forEach((q) => setAns(cid, q.id, { status: 'answered' }))}>
                      3問とも回答済みにする
                    </button>
                  </div>
                  <ul className="space-y-3">
                    {curSet.questions.map((q) => {
                      const a = ans(cid, q.id);
                      return (
                        <li key={q.id}>
                          <p className="text-base font-semibold">Q{q.position}. {q.text}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {(['unanswered', 'answered', 'passed'] as AnswerStatus[]).map((st) => (
                              <label key={st} className="btn-sub !min-h-10 cursor-pointer text-sm has-[:checked]:!border-slate-800 has-[:checked]:!bg-slate-800 has-[:checked]:!text-white">
                                <input type="radio" className="sr-only" name={`a-${cid}-${q.id}`} checked={a.status === st} onChange={() => setAns(cid, q.id, { status: st })} />
                                {{ unanswered: '未回答', answered: '回答済み', passed: 'パス' }[st]}
                              </label>
                            ))}
                            {a.status === 'answered' ? (
                              <label className="text-sm">回答日 <input type="date" className="input !inline-block !w-auto" max={today} min={shotOn} value={a.answeredOn || shotOn} onChange={(e) => setAns(cid, q.id, { answeredOn: e.target.value })} /></label>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="card space-y-3">
        <legend className="px-1 text-sm font-bold text-mat-700">{isInterview ? '4' : '3'}. 素材の内容</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="撮影・作成日" htmlFor="shotOn" required error={fields.shotOn}>
            <input id="shotOn" type="date" className={cls('shotOn')} value={shotOn} max={today} onChange={(e) => setShotOn(e.target.value)} />
          </Field>
          <Field label="作業状態" htmlFor="status" error={fields.status}>
            <select id="status" className="input" value={status} onChange={(e) => setStatus(e.target.value as MaterialStatus)}>
              {MATERIAL_STATES.map((s) => (<option key={s.key} value={s.key}>{s.name}</option>))}
            </select>
          </Field>
        </div>
        <Field label={isInterview ? 'タイトル（空欄なら自動）' : 'タイトル'} htmlFor="title" required={!isInterview} error={fields.title}>
          <input id="title" className={cls('title')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isInterview ? '例: SET 01 撮影1回目' : '例: 9月 セルフPR画像'} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {isInterview ? (
            <Field label="動画の本数" htmlFor="quantity" error={fields.videoCount ?? fields.quantity} hint="1回の撮影で複数の動画ファイルがある場合は本数を入れてください。">
              <input id="quantity" inputMode="numeric" className={cls('quantity')} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="形式" htmlFor="mediaKind" error={fields.mediaKind}>
                {cat.allowed_media_kinds.length === 1 ? (
                  <p className="input flex items-center bg-slate-50">{MEDIA_LABEL[cat.allowed_media_kinds[0]]}</p>
                ) : (
                  <select id="mediaKind" className="input" value={mediaKind} onChange={(e) => setMediaKind(e.target.value as MediaKind)}>
                    {cat.allowed_media_kinds.map((k) => (<option key={k} value={k}>{MEDIA_LABEL[k]}</option>))}
                  </select>
                )}
              </Field>
              <Field label={`数量（${UNIT[mediaKind]}）`} htmlFor="quantity" required error={fields.quantity} hint="正の整数のみ。例: 10 → 個別素材が10点作られます。">
                <input id="quantity" inputMode="numeric" className={cls('quantity')} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        {preview ? <p className="text-sm text-mat-700" data-testid="qty-preview">{preview}</p> : null}
        <Field label="ファイルの用途" htmlFor="purpose" error={fields.purpose}>
          <select id="purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => (<option key={p.key} value={p.key}>{p.name}</option>))}
          </select>
        </Field>
        <Field label="保存場所URL（任意）" htmlFor="storageUrl" error={fields.storageUrl} hint="Google Drive等の保管場所の記録です。サイトがファイルを取得・確認することはありません。">
          <input id="storageUrl" inputMode="url" className={cls('storageUrl')} value={storageUrl} onChange={(e) => setStorageUrl(e.target.value)} placeholder="https://" />
        </Field>
        <Field label="メモ（任意）" htmlFor="memo" error={fields.memo}>
          <textarea id="memo" rows={3} className={cls('memo')} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
      </fieldset>

      {storageReady ? (
        <fieldset className="card space-y-2">
          <legend className="px-1 text-sm font-bold text-mat-700">ファイル（任意）</legend>
          <input type="file" accept="image/*,video/*" multiple data-testid="material-files" className="input" onChange={(e) => setFiles(Array.from(e.target.files ?? []).sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true })))} />
          <p className="text-xs text-slate-500">選んだファイルは名前順に、登録される個別素材（番号順）へ割り当てて保存します。数量以下の枚数にしてください。1ファイル2GBまで。後から素材詳細でも追加できます。</p>
          {files.length ? <p className="text-sm">{files.length}件を選択中</p> : null}
          {fields.files ? <p role="alert" className="text-sm font-medium text-red-700">{fields.files}</p> : null}
        </fieldset>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600" data-testid="upload-unavailable">ファイルのアップロードは未設定です（環境変数 SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定して再デプロイすると、ここにファイル選択が出ます）。保存場所URLの記録は今でも使えます。</p>
      )}
      <ErrorBanner message={error} />
      {progress ? <p role="status" className="rounded-lg border border-sky-300 bg-sky-50 p-2 text-sm">{progress}</p> : null}
      <div className="sticky bottom-16 z-10 -mx-1 flex gap-2 rounded-xl bg-white/90 p-2 backdrop-blur md:static md:bg-transparent md:p-0">
        <button type="submit" className="btn-mat flex-1 sm:flex-none" disabled={busy || !!progress} data-testid="submit-material">{busy || progress ? '保存中…' : '素材を登録する'}</button>
        <button type="button" className="btn-sub" onClick={() => router.back()} disabled={busy}>キャンセル</button>
      </div>
    </form>
  );
}
