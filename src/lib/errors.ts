export type ErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'validation' | 'conflict';

/** 画面に日本語で表示できるアプリ例外。fields には項目別のエラーを入れる */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const validation = (message: string, fields: Record<string, string> = {}) =>
  new AppError('validation', message, fields);
export const notFound = (what = '対象') => new AppError('not_found', `${what}が見つかりません。`);
export const forbidden = (message = 'この操作を行う権限がありません。') => new AppError('forbidden', message);
