/** 日本時間(Asia/Tokyo, UTC+9, 夏時間なし)の日付ユーティリティ */
const JST_MS = 9 * 60 * 60 * 1000;

/** 瞬間(ISO文字列/Date) → 日本時間の日付 'YYYY-MM-DD' */
export function jstDate(at: string | Date): string {
  const ms = (typeof at === 'string' ? new Date(at) : at).getTime() + JST_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 日本時間の 'HH:mm' */
export function jstTime(at: string | Date): string {
  const ms = (typeof at === 'string' ? new Date(at) : at).getTime() + JST_MS;
  return new Date(ms).toISOString().slice(11, 16);
}

export function jstToday(now: Date = new Date()): string {
  return jstDate(now);
}

/** 日本時間の 'YYYY-MM-DD' の 0:00 の瞬間(ISO UTC) */
export function jstDayStart(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toISOString();
}

/** 'YYYY-MM-DD' に日数を加算 */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 日本時間の 'YYYY-MM-DDTHH:mm' (datetime-local入力) → ISO(UTC)。不正なら null */
export function fromJstLocal(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → datetime-local 用の日本時間文字列 */
export function toJstLocal(at: string): string {
  return `${jstDate(at)}T${jstTime(at)}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 月(日本時間)の [開始, 終了) の瞬間。 month = 'YYYY-MM' */
export function monthRange(month: string): { from: string; to: string } {
  return { from: jstDayStart(`${month}-01`), to: jstDayStart(`${shiftMonth(month, 1)}-01`) };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function formatJaDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WD[d.getUTCDay()]})`;
}
export function formatJaDateTime(at: string): string {
  return `${formatJaDate(jstDate(at))} ${jstTime(at)}`;
}
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export type Period =
  | { kind: 'all' }
  | { kind: 'month'; month: string; from: string; to: string }
  | { kind: 'custom'; fromDate: string; toDate: string; from: string; to: string };

/** URLパラメータから期間を作る。今月は常に現在の日本時間の当月 */
export function parsePeriod(
  params: { period?: string; from?: string; to?: string },
  now: Date = new Date(),
): Period {
  if (params.period === 'month') {
    const month = monthOf(jstToday(now));
    return { kind: 'month', month, ...monthRange(month) };
  }
  if (
    params.period === 'custom' &&
    params.from &&
    params.to &&
    isValidDate(params.from) &&
    isValidDate(params.to) &&
    params.from <= params.to
  ) {
    return {
      kind: 'custom',
      fromDate: params.from,
      toDate: params.to,
      from: jstDayStart(params.from),
      to: jstDayStart(addDays(params.to, 1)),
    };
  }
  return { kind: 'all' };
}

export function periodLabel(p: Period): string {
  if (p.kind === 'all') return '全期間';
  if (p.kind === 'month') return `今月（${p.month.replace('-', '年')}月）`;
  return `${p.fromDate} 〜 ${p.toDate}`;
}
