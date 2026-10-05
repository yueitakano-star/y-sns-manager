import crypto from 'node:crypto';
import { AppError } from './errors';

/**
 * Google ドライブ(読み取り専用)。サービスアカウントのキーで認証し、そのアカウントに「閲覧者」で共有されたフォルダだけ読める。
 * キー(JSON)はサーバー専用の環境変数 GOOGLE_SERVICE_ACCOUNT_JSON（JSONそのまま、またはBase64）。
 */
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface Credentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function credentials(): Credentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const j = JSON.parse(text) as Credentials;
    if (!j.client_email || !j.private_key) return null;
    return { ...j, private_key: j.private_key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

export const driveConfigured = () => credentials() !== null;
export const serviceAccountEmail = () => credentials()?.client_email ?? null;

const apiBase = () => process.env.GOOGLE_DRIVE_API_BASE || 'https://www.googleapis.com';
const tokenUrl = (c: Credentials) => process.env.GOOGLE_TOKEN_URL || c.token_uri || 'https://oauth2.googleapis.com/token';

let cached: { token: string; exp: number } | null = null;
export function resetDriveTokenCache() {
  cached = null;
}

const b64 = (o: object | Buffer) => Buffer.from(o instanceof Buffer ? o : JSON.stringify(o)).toString('base64url');

async function accessToken(fetchImpl: typeof fetch): Promise<string> {
  const c = credentials();
  if (!c) throw new AppError('validation', 'Googleドライブ連携が未設定です（環境変数 GOOGLE_SERVICE_ACCOUNT_JSON）。');
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claims = b64({ iss: c.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: tokenUrl(c), iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(c.private_key);
  const res = await fetchImpl(tokenUrl(c), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64(sig)}` }),
    cache: 'no-store',
  }).catch(() => null);
  if (!res || !res.ok) throw new AppError('validation', 'Googleの認証に失敗しました。サービスアカウントのキーが正しいか確認してください。');
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: number | null;
  createdTime: string | null;
  modifiedTime: string | null;
  /** 撮影日時(EXIF)があれば 'YYYY-MM-DDTHH:mm:ss' */
  photoTime: string | null;
  webViewLink: string;
  thumbnailLink: string | null;
}

const FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,thumbnailLink,imageMediaMetadata/time';

type Raw = { id: string; name: string; mimeType: string; size?: string; createdTime?: string; modifiedTime?: string; webViewLink?: string; thumbnailLink?: string; imageMediaMetadata?: { time?: string } };
const toFile = (r: Raw): DriveFile => ({
  id: r.id,
  name: r.name,
  mimeType: r.mimeType,
  isFolder: r.mimeType === FOLDER_MIME,
  size: r.size ? Number(r.size) : null,
  createdTime: r.createdTime ?? null,
  modifiedTime: r.modifiedTime ?? null,
  photoTime: r.imageMediaMetadata?.time ? r.imageMediaMetadata.time.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') : null,
  webViewLink: r.webViewLink ?? `https://drive.google.com/${r.mimeType === FOLDER_MIME ? 'drive/folders' : 'file/d'}/${r.id}`,
  thumbnailLink: r.thumbnailLink ?? null,
});

function fail(status: number): never {
  const mail = serviceAccountEmail();
  if (status === 404 || status === 403) {
    throw new AppError('validation', `ドライブのフォルダを開けませんでした。フォルダを ${mail ?? 'サービスアカウント'} に「閲覧者」として共有しているか確認してください。`);
  }
  throw new AppError('validation', `Googleドライブの呼び出しに失敗しました（${status}）。しばらくして、もう一度お試しください。`);
}

async function get(path: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<Response> {
  const token = await accessToken(fetchImpl);
  const url = `${apiBase()}/drive/v3/${path}?${new URLSearchParams({ supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...params })}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res) throw new AppError('validation', 'Googleドライブに接続できませんでした。通信状況を確認してください。');
  if (!res.ok) fail(res.status);
  return res;
}

/** URL（フォルダ／ファイル／open?id=）または ID そのものから Drive の ID を取り出す */
export function parseDriveId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{15,}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname !== 'drive.google.com' && u.hostname !== 'docs.google.com') return null;
    const m = u.pathname.match(/\/(?:folders|d)\/([A-Za-z0-9_-]+)/);
    return m?.[1] ?? u.searchParams.get('id');
  } catch {
    return null;
  }
}

export async function getDriveFile(id: string, fetchImpl: typeof fetch = fetch): Promise<DriveFile> {
  return toFile((await (await get(`files/${encodeURIComponent(id)}`, { fields: FIELDS }, fetchImpl)).json()) as Raw);
}

export async function listChildren(folderId: string, opts: { max?: number; pageSize?: number } = {}, fetchImpl: typeof fetch = fetch): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  const max = opts.max ?? 1000;
  do {
    const res = await get(
      'files',
      { q: `'${folderId.replace(/'/g, '')}' in parents and trashed = false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: String(Math.min(opts.pageSize ?? 1000, 1000)), orderBy: 'name', ...(pageToken ? { pageToken } : {}) },
      fetchImpl,
    );
    const j = (await res.json()) as { files: Raw[]; nextPageToken?: string };
    out.push(...j.files.map(toFile));
    pageToken = j.nextPageToken;
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

export interface TreeFile extends DriveFile {
  /** ルートからのフォルダ名の並び */
  path: string[];
}

/** フォルダ配下のファイルを再帰的に集める（深さと件数に上限） */
export async function listTree(rootId: string, opts: { depth?: number; max?: number } = {}, fetchImpl: typeof fetch = fetch): Promise<{ files: TreeFile[]; truncated: boolean }> {
  const maxDepth = opts.depth ?? 3;
  const max = opts.max ?? 500;
  const files: TreeFile[] = [];
  let truncated = false;
  const walk = async (id: string, path: string[], depth: number) => {
    for (const f of await listChildren(id, { max: max + 1 }, fetchImpl)) {
      if (files.length >= max) { truncated = true; return; }
      if (f.isFolder) {
        if (depth < maxDepth) await walk(f.id, [...path, f.name], depth + 1);
        else truncated = true;
      } else files.push({ ...f, path });
      if (truncated && files.length >= max) return;
    }
  };
  await walk(rootId, [], 0);
  return { files, truncated };
}

/** サムネイル画像（サーバーが認証付きで取得し、そのまま返す）。取得できなければ null */
export async function fetchDriveThumbnail(id: string, size = 400, fetchImpl: typeof fetch = fetch): Promise<{ body: ArrayBuffer; type: string } | null> {
  let file = await getDriveFile(id, fetchImpl);
  if (file.isFolder) {
    // フォルダは、中の最初のファイルのサムネイルを代表にする
    const kids = await listChildren(id, { pageSize: 20, max: 20 }, fetchImpl);
    file = kids.find((k) => !k.isFolder && k.thumbnailLink) ?? file;
  }
  if (!file.thumbnailLink) return null;
  const token = await accessToken(fetchImpl);
  const res = await fetchImpl(file.thumbnailLink.replace(/=s\d+$/, `=s${size}`), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) return null;
  return { body: await res.arrayBuffer(), type: res.headers.get('content-type') ?? 'image/jpeg' };
}
