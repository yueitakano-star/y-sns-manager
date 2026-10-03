import type { Period } from '@/lib/jst';
import { periodLabel } from '@/lib/jst';

/** 投稿件数の期間切替（GETフォーム）。素材在庫・質問の進捗は常に現在の全期間 */
export function PeriodFilter({ period, hidden = {} }: { period: Period; hidden?: Record<string, string | undefined> }) {
  const cur = period.kind;
  const links = [
    { v: 'all', label: '全期間' },
    { v: 'month', label: '今月' },
    { v: 'custom', label: '期間指定' },
  ];
  return (
    <form method="get" className="card mb-4 flex flex-wrap items-end gap-3" aria-label="投稿件数の期間">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <fieldset className="min-w-0">
        <legend className="label">投稿件数の期間（日本時間）</legend>
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <label key={l.v} className="btn-sub cursor-pointer has-[:checked]:!border-slate-800 has-[:checked]:!bg-slate-800 has-[:checked]:!text-white has-[:focus-visible]:outline-2">
              <input type="radio" name="period" value={l.v} defaultChecked={cur === l.v} className="sr-only" />
              {l.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="text-sm font-semibold text-slate-700">
        開始
        <input type="date" name="from" defaultValue={period.kind === 'custom' ? period.fromDate : ''} className="input mt-1 font-normal" />
      </label>
      <label className="text-sm font-semibold text-slate-700">
        終了
        <input type="date" name="to" defaultValue={period.kind === 'custom' ? period.toDate : ''} className="input mt-1 font-normal" />
      </label>
      <button type="submit" className="btn-primary">表示</button>
      <p className="w-full text-xs text-slate-500">
        表示中: <strong>{periodLabel(period)}</strong> の「投稿済み／投稿予定」件数。素材の在庫と質問の進捗は、期間に関係なく<strong>現在の全期間</strong>の値です。
      </p>
    </form>
  );
}
