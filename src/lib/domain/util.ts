import { z } from 'zod';
import { validation } from '../errors';
import { isValidDate } from '../jst';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const reqStr = (label: string, max = 200) =>
  z
    .string({ error: `${label}を入力してください。` })
    .trim()
    .min(1, `${label}を入力してください。`)
    .max(max, `${label}は${max}文字以内にしてください。`);

export const optStr = (label: string, max = 2000) =>
  z
    .string({ error: `${label}の形式が正しくありません。` })
    .trim()
    .max(max, `${label}は${max}文字以内にしてください。`)
    .nullish()
    .transform((v) => (v ? v : null));

export const idStr = (label: string) =>
  z.string({ error: `${label}を選択してください。` }).regex(UUID_RE, `${label}が正しくありません。`);

export const dateStr = (label: string) =>
  z
    .string({ error: `${label}を入力してください。` })
    .refine(isValidDate, `${label}を正しい日付で入力してください。`);

/** http/https のみ許可。任意URLをサーバーが取得することはない（記録のみ） */
export const urlOpt = (label: string) =>
  z
    .string({ error: `${label}の形式が正しくありません。` })
    .trim()
    .max(2000, `${label}は2000文字以内にしてください。`)
    .nullish()
    .refine(
      (v) => {
        if (!v) return true;
        try {
          const u = new URL(v);
          return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
          return false;
        }
      },
      `${label}は http:// または https:// で始まるURLを入力してください。`,
    )
    .transform((v) => (v ? v : null));

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = r.error.issues[0];
  throw validation(first?.message ?? '入力内容を確認してください。', fields);
}

export function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
