import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  MATERIAL_STATE_LABEL,
  POST_STATE_LABEL,
  type MaterialStatus,
  type PostStatus,
} from '@/lib/constants';

export function PageHeader({ title, sub, actions, kind }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; kind?: 'mat' | 'post' }) {
  const bar = kind === 'mat' ? 'border-mat-600' : kind === 'post' ? 'border-post-600' : 'border-slate-800';
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className={`border-l-4 pl-3 ${bar}`}>
        <h1 className="text-xl font-bold leading-tight">{title}</h1>
        {sub ? <p className="mt-0.5 text-sm text-slate-600">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, kind, right }: { children: ReactNode; kind?: 'mat' | 'post'; right?: ReactNode }) {
  const color = kind === 'mat' ? 'bg-mat-50 text-mat-700 border-mat-100' : kind === 'post' ? 'bg-post-50 text-post-700 border-post-100' : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <div className={`mb-2 mt-6 flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold ${color}`}>
      <span>{children}</span>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, kind }: { label: string; value: ReactNode; sub?: ReactNode; kind?: 'mat' | 'post' }) {
  const tone = kind === 'mat' ? 'border-mat-100 bg-mat-50' : kind === 'post' ? 'border-post-100 bg-post-50' : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
      <p>{children}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

const TONES = {
  slate: 'border-slate-300 bg-slate-100 text-slate-700',
  green: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-300 bg-amber-50 text-amber-800',
  red: 'border-red-300 bg-red-50 text-red-700',
  mat: 'border-mat-100 bg-mat-50 text-mat-700',
  post: 'border-post-100 bg-post-50 text-post-700',
  blue: 'border-sky-300 bg-sky-50 text-sky-800',
};
export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`badge ${TONES[tone]}`}>{children}</span>;
}

export function MaterialStatusBadge({ status }: { status: MaterialStatus }) {
  const tone = status === 'ready' ? 'green' : status === 'unusable' ? 'red' : status === 'editing' ? 'amber' : 'slate';
  const icon = { ready: '✓', unusable: '✕', editing: '✎', captured: '●' }[status];
  return <Badge tone={tone}>{icon} {MATERIAL_STATE_LABEL[status]}</Badge>;
}

export function PostStatusBadge({ status }: { status: PostStatus }) {
  const tone = status === 'published' ? 'green' : status === 'scheduled' ? 'blue' : status === 'cancelled' ? 'red' : 'slate';
  const icon = { published: '✔', scheduled: '⏰', cancelled: '✕', draft: '✎' }[status];
  return <Badge tone={tone}>{icon} {POST_STATE_LABEL[status]}</Badge>;
}

export function SetBadge({ state }: { state: 'none' | 'noanswer' | 'partial' | 'done' }) {
  const m = {
    none: ['slate', '未実施'],
    noanswer: ['amber', '実施・回答なし'],
    partial: ['blue', '一部回答'],
    done: ['green', '3問完了'],
  } as const;
  return <Badge tone={m[state][0]}>{m[state][1]}</Badge>;
}

export function LinkBtn({ href, children, kind = 'sub' }: { href: string; children: ReactNode; kind?: 'primary' | 'mat' | 'post' | 'sub' }) {
  return (
    <Link href={href} className={`btn-${kind}`}>
      {children}
    </Link>
  );
}

/** GETフォーム用の選択肢つきセレクト（サーバーコンポーネントで使える） */
export function SelectField({ name, label, value, options, all = 'すべて' }: { name: string; label: string; value?: string; options: { value: string; label: string }[]; all?: string }) {
  return (
    <label className="block min-w-32 flex-1 text-sm font-semibold text-slate-700">
      {label}
      <select name={name} defaultValue={value ?? ''} className="input mt-1 font-normal">
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function fmtNum(n: number) {
  return n.toLocaleString('ja-JP');
}
