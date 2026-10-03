import Link from 'next/link';
import type { CastStatRow, StoreStats } from '@/lib/domain/stats';
import { QUESTION_COUNT, SET_COUNT } from '@/lib/constants';
import { jstDate } from '@/lib/jst';
import { Badge, Empty, SelectField } from './ui';

export interface CastListParams {
  q?: string;
  status?: string;
  flag?: string;
  sort?: string;
}

export function applyCastParams(rows: CastStatRow[], p: CastListParams): CastStatRow[] {
  let out = rows;
  const q = p.q?.trim().toLowerCase();
  if (q) out = out.filter((r) => r.display_name.toLowerCase().includes(q) || (r.furigana ?? '').toLowerCase().includes(q));
  if (p.status === 'active' || p.status === 'inactive') out = out.filter((r) => r.status === p.status);
  if (p.flag === 'shortage') out = out.filter((r) => r.unused_ready === 0);
  if (p.flag === 'unposted') out = out.filter((r) => r.published_posts === 0);
  if (p.flag === 'ready') out = out.filter((r) => r.unused_ready > 0);
  const sorted = [...out];
  switch (p.sort) {
    case 'posts_desc': sorted.sort((a, b) => b.published_posts - a.published_posts); break;
    case 'posts_asc': sorted.sort((a, b) => a.published_posts - b.published_posts); break;
    case 'unused_desc': sorted.sort((a, b) => b.unused_items - a.unused_items); break;
    case 'last_post_asc':
      sorted.sort((a, b) => (a.last_published ?? '').localeCompare(b.last_published ?? ''));
      break;
    default: break;
  }
  return sorted;
}

const fmtDate = (d: string | null) => (d ? d : '—');
const fmtTs = (d: string | null) => (d ? jstDate(d) : '—');

export function CastFilterForm({ params, hidden = {} }: { params: CastListParams; hidden?: Record<string, string | undefined> }) {
  return (
    <form method="get" className="card mb-3 flex flex-wrap items-end gap-3" aria-label="キャストの絞り込み">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="block min-w-40 flex-[2] text-sm font-semibold text-slate-700">
        名前検索
        <input name="q" defaultValue={params.q ?? ''} className="input mt-1 font-normal" placeholder="表示名・ふりがな" />
      </label>
      <SelectField name="status" label="在籍" value={params.status} options={[{ value: 'active', label: '在籍のみ' }, { value: 'inactive', label: '非表示・退店のみ' }]} />
      <SelectField name="flag" label="絞り込み" value={params.flag} options={[
        { value: 'shortage', label: '素材不足（投稿可能な未使用が0）' },
        { value: 'unposted', label: '未投稿（投稿済み0件）' },
        { value: 'ready', label: '投稿可能な素材あり' },
      ]} />
      <SelectField name="sort" label="並べ替え" value={params.sort} all="標準（並び順）" options={[
        { value: 'posts_desc', label: '投稿数が多い順' },
        { value: 'posts_asc', label: '投稿数が少ない順' },
        { value: 'unused_desc', label: '未使用素材が多い順' },
        { value: 'last_post_asc', label: '最終投稿日が古い順' },
      ]} />
      <button className="btn-primary" type="submit">絞り込む</button>
    </form>
  );
}

export function CastStatsList({ rows, base, common, emptyAction }: { rows: CastStatRow[]; base: string; common?: StoreStats['common']; emptyAction?: React.ReactNode }) {
  if (rows.length === 0 && !(common && (common.items || common.publishedPosts))) {
    return <Empty action={emptyAction}>該当するキャストがいません。</Empty>;
  }
  return (
    <>
      {/* PC: 比較しやすい表 */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="w-full border-collapse" data-testid="cast-table">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">キャスト名</th>
              <th className="th text-right">画像(枚)</th>
              <th className="th text-right">動画(本)</th>
              <th className="th text-right">その他(点)</th>
              <th className="th text-right">使用済み素材</th>
              <th className="th text-right">未使用素材</th>
              <th className="th text-right">未使用・投稿可能</th>
              <th className="th text-right">完了セット/{SET_COUNT}</th>
              <th className="th text-right">回答質問/{QUESTION_COUNT}</th>
              <th className="th text-right">投稿済み</th>
              <th className="th text-right">投稿予定</th>
              <th className="th">最終撮影日</th>
              <th className="th">最終投稿日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.status === 'inactive' ? 'bg-slate-50 text-slate-500' : ''}>
                <td className="td font-semibold">
                  <Link href={`${base}/casts/${r.id}`} className="text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-800">{r.display_name}</Link>
                  {r.status === 'inactive' ? <span className="ml-1"><Badge>非表示・退店</Badge></span> : null}
                </td>
                <td className="td text-right tabular-nums">{r.images}</td>
                <td className="td text-right tabular-nums">{r.videos}</td>
                <td className="td text-right tabular-nums">{r.others}</td>
                <td className="td text-right tabular-nums">{r.used_items}</td>
                <td className="td text-right tabular-nums">{r.unused_items}</td>
                <td className="td text-right tabular-nums">{r.unused_ready}</td>
                <td className="td text-right tabular-nums">{r.done_sets}</td>
                <td className="td text-right tabular-nums">{r.answered_questions}</td>
                <td className="td text-right tabular-nums">{r.published_posts}</td>
                <td className="td text-right tabular-nums">{r.scheduled_posts}</td>
                <td className="td whitespace-nowrap">{fmtDate(r.last_shot)}</td>
                <td className="td whitespace-nowrap">{fmtTs(r.last_published)}</td>
              </tr>
            ))}
            {common && (common.items > 0 || common.publishedPosts > 0) ? (
              <tr className="bg-amber-50/50">
                <td className="td font-semibold">店舗共通（キャストなし）</td>
                <td className="td text-right tabular-nums">{common.images}</td>
                <td className="td text-right tabular-nums">{common.videos}</td>
                <td className="td text-right tabular-nums">{common.others}</td>
                <td className="td text-slate-400" colSpan={5}>素材 {common.items}点 ／ 投稿済み {common.publishedPosts}件</td>
                <td className="td" colSpan={4}></td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* スマホ: カード＋展開 */}
      <ul className="space-y-2 md:hidden" data-testid="cast-cards">
        {rows.map((r) => (
          <li key={r.id}>
            <details className="card !p-0">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 p-3">
                <span className="font-bold">
                  {r.display_name}
                  {r.status === 'inactive' ? <span className="ml-1"><Badge>非表示・退店</Badge></span> : null}
                </span>
                <span className="text-right text-xs text-slate-600">
                  素材 <b className="text-sm text-slate-900">{r.total_items}</b>
                  <span className="mx-1">/</span>未使用 <b className="text-sm text-slate-900">{r.unused_items}</b>
                  <span className="mx-1">/</span>投稿済み <b className="text-sm text-slate-900">{r.published_posts}</b>
                </span>
              </summary>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 p-3 text-sm">
                <Row k="画像" v={`${r.images}枚`} />
                <Row k="動画" v={`${r.videos}本`} />
                <Row k="その他" v={`${r.others}点`} />
                <Row k="使用済み素材" v={r.used_items} />
                <Row k="未使用素材" v={r.unused_items} />
                <Row k="未使用・投稿可能" v={r.unused_ready} />
                <Row k={`完了セット/${SET_COUNT}`} v={r.done_sets} />
                <Row k={`回答質問/${QUESTION_COUNT}`} v={r.answered_questions} />
                <Row k="投稿済み" v={r.published_posts} />
                <Row k="投稿予定" v={r.scheduled_posts} />
                <Row k="最終撮影日" v={fmtDate(r.last_shot)} />
                <Row k="最終投稿日" v={fmtTs(r.last_published)} />
                <div className="col-span-2 mt-2">
                  <Link href={`${base}/casts/${r.id}`} className="btn-sub w-full">詳細を見る</Link>
                </div>
              </dl>
            </details>
          </li>
        ))}
        {common && (common.items > 0 || common.publishedPosts > 0) ? (
          <li className="card bg-amber-50/50 text-sm">
            <b>店舗共通（キャストなし）</b>：素材 {common.items}点（画像{common.images}／動画{common.videos}／その他{common.others}）・投稿済み {common.publishedPosts}件
          </li>
        ) : null}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        ※ 複数キャストが出演する投稿は各キャストで1件ずつ数えるため、キャスト別の合計と店舗全体の合計は一致しない場合があります。投稿件数は選択中の期間、素材・回答は現在の全期間の値です。
      </p>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-semibold tabular-nums">{v}</dd>
    </>
  );
}
