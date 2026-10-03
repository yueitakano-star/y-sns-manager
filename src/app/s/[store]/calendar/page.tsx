import Link from 'next/link';
import { pageCtx, one, many, type SP } from '@/lib/page';
import { calendarEvents, type CalEvent, type CalKind } from '@/lib/domain/calendar';
import { listCasts } from '@/lib/domain/casts';
import { PLATFORMS } from '@/lib/constants';
import { addDays, formatJaDate, isValidDate, jstToday, monthOf, shiftMonth, weekdayOf } from '@/lib/jst';
import { Empty, PageHeader, SelectField } from '@/components/ui';

const KINDS: { key: CalKind; label: string; icon: string; chip: string }[] = [
  { key: 'interview', label: 'インタビュー撮影・回答', icon: '◉', chip: 'border-amber-300 bg-amber-50 text-amber-900' },
  { key: 'material', label: '素材の撮影・作成', icon: '▣', chip: 'border-mat-100 bg-mat-50 text-mat-700' },
  { key: 'scheduled', label: '投稿予定', icon: '⏰', chip: 'border-sky-300 bg-sky-50 text-sky-900' },
  { key: 'published', label: '投稿済み', icon: '✔', chip: 'border-post-100 bg-post-50 text-post-700' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k])) as Record<CalKind, (typeof KINDS)[number]>;
const SHORT: Record<CalKind, string> = { interview: '撮影・回答', material: '素材', scheduled: '予定', published: '投稿' };

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ store: string }>; searchParams: Promise<SP> }) {
  const { db, user, store, base } = await pageCtx(params);
  const sp = await searchParams;
  const today = jstToday();
  const monthParam = one(sp.month);
  const month = monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : monthOf(today);
  const kindsParam = many(sp.kind).filter((k): k is CalKind => k in KIND);
  const kinds = kindsParam.length ? kindsParam : (KINDS.map((k) => k.key) as CalKind[]);
  const castId = one(sp.cast);
  const platform = one(sp.platform);
  const dayParam = one(sp.day);
  const selected = dayParam && isValidDate(dayParam) ? dayParam : monthOf(today) === month ? today : `${month}-01`;

  const first = `${month}-01`;
  const gridStart = addDays(first, -weekdayOf(first));
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const gridEnd = addDays(last, 6 - weekdayOf(last));
  const casts = await listCasts(db, user, store.id);
  const events = await calendarEvents(db, user, store.id, gridStart, gridEnd, base, { castId, kinds, platform });

  const byDate = new Map<string, CalEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = { month, day: selected, cast: castId, platform, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    if (kindsParam.length) kindsParam.forEach((k) => p.append('kind', k));
    return `?${p.toString()}`;
  };

  const days: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const dayEvents = byDate.get(selected) ?? [];
  const [yy, mm] = month.split('-');

  return (
    <>
      <PageHeader title="カレンダー" sub={`${store.name}・保存済みの記録から自動で作られる表示です（日本時間）`} />

      <form method="get" className="card mb-3 space-y-3" aria-label="カレンダーの絞り込み">
        <input type="hidden" name="month" value={month} />
        <fieldset>
          <legend className="label">表示する記録</legend>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <label key={k.key} className={`badge cursor-pointer !px-3 !py-2 text-sm ${k.chip} has-[:not(:checked)]:opacity-50`}>
                <input type="checkbox" name="kind" value={k.key} defaultChecked={kinds.includes(k.key)} className="size-4" />
                <span aria-hidden>{k.icon}</span> {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <SelectField name="cast" label="キャスト" value={castId} options={casts.map((c) => ({ value: c.id, label: c.display_name }))} />
          <SelectField name="platform" label="投稿先（投稿の記録のみ）" value={platform} options={PLATFORMS.map((p) => ({ value: p.key, label: p.name }))} />
          <button className="btn-primary" type="submit">絞り込む</button>
        </div>
      </form>

      <div className="mb-2 flex items-center justify-between gap-2">
        <Link className="btn-sub" href={qs({ month: shiftMonth(month, -1), day: undefined })} aria-label="前月">‹ 前月</Link>
        <h2 className="text-lg font-bold" data-testid="cal-month">{yy}年{Number(mm)}月</h2>
        <div className="flex gap-2">
          <Link className="btn-sub" href={qs({ month: monthOf(today), day: today })}>今日</Link>
          <Link className="btn-sub" href={qs({ month: shiftMonth(month, 1), day: undefined })} aria-label="翌月">翌月 ›</Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="cal-grid">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold">
          {['日', '月', '火', '水', '木', '金', '土'].map((w, i) => (<div key={w} className={`py-1.5 ${i === 0 ? 'text-red-600' : i === 6 ? 'text-sky-700' : ''}`}>{w}</div>))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const evs = byDate.get(d) ?? [];
            const inMonth = d.startsWith(month);
            const kindsHere = [...new Set(evs.map((e) => e.kind))];
            return (
              <Link key={d} href={qs({ day: d, month: inMonth ? month : monthOf(d) })} aria-label={`${formatJaDate(d)} ${evs.length}件`} aria-current={d === selected ? 'date' : undefined} data-date={d}
                className={`min-h-16 border-b border-r border-slate-100 p-1 md:min-h-28 ${inMonth ? '' : 'bg-slate-50/70 text-slate-400'} ${d === selected ? 'outline-2 -outline-offset-2 outline-slate-800' : ''} hover:bg-slate-50`}>
                <div className={`text-xs font-bold ${d === today ? 'inline-flex size-6 items-center justify-center rounded-full bg-slate-800 text-white' : ''}`}>{Number(d.slice(8))}</div>
                {/* スマホ: 種類アイコンと件数のみ */}
                {evs.length ? (
                  <div className="mt-0.5 flex flex-wrap gap-0.5 md:hidden">
                    {kindsHere.map((k) => (<span key={k} className={`rounded border px-1 text-[10px] font-bold leading-4 ${KIND[k].chip}`}>{KIND[k].icon}{evs.filter((e) => e.kind === k).length}</span>))}
                  </div>
                ) : null}
                {/* PC: 先頭3件＋ほか○件 */}
                <ul className="mt-0.5 hidden space-y-0.5 md:block">
                  {evs.slice(0, 3).map((e) => (
                    <li key={e.key} className={`truncate rounded border px-1 text-[11px] leading-5 ${KIND[e.kind].chip}`} title={`${e.who} ${e.what} ${e.detail}`}>
                      <span aria-hidden>{KIND[e.kind].icon}</span> {SHORT[e.kind]} {e.who}
                    </li>
                  ))}
                  {evs.length > 3 ? <li className="text-[11px] font-semibold text-slate-600">ほか{evs.length - 3}件</li> : null}
                </ul>
              </Link>
            );
          })}
        </div>
      </div>

      <h3 className="mb-2 mt-5 text-base font-bold" data-testid="cal-day-title">{formatJaDate(selected)} の記録（{dayEvents.length}件）</h3>
      {dayEvents.length === 0 ? (
        <Empty>この日の記録はありません。</Empty>
      ) : (
        <ul className="space-y-2" data-testid="cal-day-list">
          {dayEvents.map((e) => (
            <li key={e.key}>
              <Link href={e.href} className={`block rounded-xl border p-3 hover:shadow ${KIND[e.kind].chip}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span aria-hidden>{KIND[e.kind].icon}</span>{KIND[e.kind].label}
                  {e.time ? <span className="font-mono">{e.time}</span> : null}
                </div>
                <div className="mt-0.5 text-base font-bold">{e.who}</div>
                <div className="text-sm">{e.what}</div>
                <div className="text-sm">{e.detail}</div>
                {e.note ? <div className="mt-0.5 text-xs">{e.note}</div> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
