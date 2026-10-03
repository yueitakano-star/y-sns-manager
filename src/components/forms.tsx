'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { ActionResult } from '@/app/actions';

export function Field({ label, error, hint, htmlFor, required, children }: { label: string; error?: string; hint?: ReactNode; htmlFor?: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm font-medium text-red-700" data-testid={`error-${htmlFor ?? label}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800" data-testid="form-error">
      {message}
    </p>
  );
}

export function SuccessBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-800" data-testid="form-success">
      {message}
    </p>
  );
}

/** サーバーアクション呼び出しの共通状態。通信中の二重送信防止・失敗時の入力保持・項目別エラーを扱う */
export function useSubmitter() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const lock = useRef(false);

  const submit = useCallback(async <T,>(fn: () => Promise<ActionResult<T>>, onOk: (d: T) => void | Promise<void>) => {
    if (lock.current) return; // 連打ガード（同期的に弾く）
    lock.current = true;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const r = await fn();
      if (r.ok) {
        await onOk(r.data);
        return;
      }
      setError(r.message);
      setFields(r.fields);
    } catch {
      setError('通信に失敗しました。保存されていません。ネットワークを確認して、もう一度お試しください。（入力内容は残っています）');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, error, fields, submit, setError, setFields };
}

/** 数量などの数値入力文字列 → 数値（空は undefined、数値でなければ NaN） */
export function toNum(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  // 数値に変換できない入力は文字列のまま送り、サーバー側の検証で日本語エラーにする
  return Number.isNaN(n) ? (t as unknown as number) : n;
}

export function newRequestKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
