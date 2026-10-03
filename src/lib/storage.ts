/** Supabase Storage（非公開バケット）へのアクセス。サービスキーはサーバー専用で、ブラウザには署名付きURLだけを渡す */
export interface StorageApi {
  configured(): boolean;
  /** ブラウザから直接アップロードするための署名付きURL（短時間有効） */
  createUploadUrl(path: string): Promise<string>;
  /** 閲覧用の署名付きURL（期限付き） */
  createDownloadUrl(path: string, expiresInSec?: number): Promise<string | null>;
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
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
}

export const supabaseStorage: StorageApi = {
  configured: () => !!(base() && key()),
  async createUploadUrl(path) {
    const r = await call('POST', `/object/upload/sign/${bucket()}/${enc(path)}`);
    if (!r.ok) throw new Error(`upload url failed: ${r.status}`);
    const j = (await r.json()) as { url: string };
    return `${base()}/storage/v1${j.url}`;
  },
  async createDownloadUrl(path, expiresInSec = 3600) {
    const r = await call('POST', `/object/sign/${bucket()}/${enc(path)}`, { expiresIn: expiresInSec });
    if (!r.ok) return null;
    const j = (await r.json()) as { signedURL: string };
    return `${base()}/storage/v1${j.signedURL}`;
  },
  async remove(path) {
    await call('DELETE', `/object/${bucket()}`, { prefixes: [path] }).catch(() => {});
  },
};
