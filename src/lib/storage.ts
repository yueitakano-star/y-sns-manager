import { AppError } from './errors';

/** Supabase Storage（非公開バケット）へのアクセス。サービスキーはサーバー専用で、ブラウザには署名付きURLだけを渡す */
export interface StorageApi {
  configured(): boolean;
  /** ブラウザから直接アップロードするための署名付きURL（短時間有効） */
  createUploadUrl(path: string): Promise<string>;
  /** 閲覧用の署名付きURL（期限付き） */
  createDownloadUrl(path: string, expiresInSec?: number): Promise<string | null>;
  /** 複数ファイルの閲覧用署名付きURLをまとめて取得（path → URL） */
  createDownloadUrls(paths: string[], expiresInSec?: number): Promise<Record<string, string>>;
  remove(path: string): Promise<void>;
}

const base = () => (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const bucket = () => process.env.SUPABASE_BUCKET || 'materials';
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${base()}/storage/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${key()}`, apikey: key(), 'Content-Type': 'application/json' },
    // Supabase(Fastify)は JSON指定で本文が空だと400になるため、POSTは必ず {} 以上を送る
    body: method === 'POST' || body !== undefined ? JSON.stringify(body ?? {}) : undefined,
    cache: 'no-store',
  });
}

export const supabaseStorage: StorageApi = {
  configured: () => !!(base() && key()),
  async createUploadUrl(path) {
    const r = await call('POST', `/object/upload/sign/${bucket()}/${enc(path)}`);
    if (!r.ok) throw new AppError('validation', `保存先(Supabase Storage)でエラーが出ました（${r.status}）: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { url: string };
    return `${base()}/storage/v1${j.url}`;
  },
  async createDownloadUrl(path, expiresInSec = 3600) {
    const r = await call('POST', `/object/sign/${bucket()}/${enc(path)}`, { expiresIn: expiresInSec });
    if (!r.ok) return null;
    const j = (await r.json()) as { signedURL: string };
    return `${base()}/storage/v1${j.signedURL}`;
  },
  async createDownloadUrls(paths, expiresInSec = 3600) {
    const out: Record<string, string> = {};
    if (!paths.length) return out;
    const r = await call('POST', `/object/sign/${bucket()}`, { expiresIn: expiresInSec, paths });
    if (!r.ok) return out;
    const j = (await r.json()) as { path: string; signedURL: string | null }[];
    for (const x of j) if (x.signedURL) out[x.path] = `${base()}/storage/v1${x.signedURL}`;
    return out;
  },
  async remove(path) {
    await call('DELETE', `/object/${bucket()}`, { prefixes: [path] }).catch(() => {});
  },
};
