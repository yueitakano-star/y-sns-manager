import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCast } from '../src/lib/domain/casts';
import { guessCasts, importDriveItems, previewDriveImport } from '../src/lib/domain/archive-import';
import { listArchiveLinks } from '../src/lib/domain/archive';
import { fetchDriveThumbnail, parseDriveId, resetDriveTokenCache } from '../src/lib/gdrive';
import { AppError } from '../src/lib/errors';
import { resetData, setupEnv, type Env } from './helpers';

let env: Env;
let B: string;
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { client_email: 'robot@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), token_uri: 'https://oauth2.example.test/token' };

beforeAll(async () => { env = await setupEnv(); B = env.stores['b-club']; });
afterAll(async () => { await env.db.close(); });
beforeEach(async () => {
  await resetData(env.db);
  await env.db.exec('TRUNCATE archive_links CASCADE');
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
  resetDriveTokenCache();
});
afterEach(() => { delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; });

const ROOT = 'ROOTFOLDERID_0000001';
const F1 = 'FOLDERASUKA_0000000001';
const F2 = 'FOLDERMISC_0000000002';
const FILE1 = 'FILEPHOTO_00000000003';
const fileObj = (id: string, name: string, mimeType: string, extra: object = {}) => ({ id, name, mimeType, createdTime: '2025-05-01T15:30:00.000Z', webViewLink: `https://drive.google.com/${mimeType.includes('folder') ? 'drive/folders' : 'file/d'}/${id}`, ...extra });

function fakeFetch() {
  const calls: { url: string; auth?: string }[] = [];
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ url, auth });
    if (url === SA.token_uri) {
      // 署名付きJWTを検証してからトークンを返す
      const assertion = new URLSearchParams(String(init?.body)).get('assertion') ?? '';
      const [h, c, s] = assertion.split('.');
      const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'));
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      if (!ok || claims.iss !== SA.client_email || !String(claims.scope).endsWith('drive.readonly')) return new Response('bad', { status: 400 });
      return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }));
    }
    if (auth !== 'Bearer tok-1') return new Response('unauthorized', { status: 401 });
    if (url.includes(`/files/${ROOT}?`)) return new Response(JSON.stringify(fileObj(ROOT, '2025 B-club', 'application/vnd.google-apps.folder')));
    if (url.includes(`/files/${FILE1}?`)) return new Response(JSON.stringify(fileObj(FILE1, 'x.jpg', 'image/jpeg', { thumbnailLink: 'https://lh3.example.test/t=s220' })));
    if (url.includes('/files/NOPERMISSION')) return new Response('{}', { status: 404 });
    if (url.includes('/drive/v3/files?')) {
      const q = new URL(url).searchParams.get('q') ?? '';
      if (q.includes(ROOT)) return new Response(JSON.stringify({ files: [fileObj(F1, 'アスカ 春撮影', 'application/vnd.google-apps.folder'), fileObj(F2, '雑多', 'application/vnd.google-apps.folder'), fileObj('LOOSEFILE_000000000004', 'ayuna.png', 'image/png', { imageMediaMetadata: { time: '2025:04:02 10:20:30' } })] }));
      if (q.includes(F1)) return new Response(JSON.stringify({ files: [fileObj('KID1_00000000000000005', 'a1.jpg', 'image/jpeg', { thumbnailLink: 'https://lh3.example.test/k=s220' })] }));
      if (q.includes(F2)) return new Response(JSON.stringify({ files: [fileObj('KID2_00000000000000006', 'b1.mp4', 'video/mp4')] }));
    }
    if (url.startsWith('https://lh3.example.test/')) return new Response('IMG', { headers: { 'content-type': 'image/jpeg' } });
    return new Response('not found', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('ドライブ連携（読み取り）', () => {
  it('URL/IDからドライブのIDを取り出せる', () => {
    expect(parseDriveId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseDriveId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseDriveId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(parseDriveId('1AbCdEfGhIjKlMnOpQrSt')).toBe('1AbCdEfGhIjKlMnOpQrSt');
    expect(parseDriveId('https://example.com/folders/abc')).toBeNull();
    expect(parseDriveId('')).toBeNull();
  });

  it('ファイル名・フォルダ名のキャスト名を推定する（2文字未満は無視、長い名前を優先）', () => {
    const casts = [{ id: '1', display_name: 'アスカ' }, { id: '2', display_name: 'カ' }, { id: '3', display_name: 'ミユ' }, { id: '4', display_name: 'ミユキ' }];
    expect(guessCasts('春撮影/アスカ_01.jpg', casts)).toEqual(['1']);
    expect(guessCasts('ミユキ と アスカ', casts).sort()).toEqual(['1', '4']); // 「ミユ」は「ミユキ」に含まれるだけなので別人として拾わない
    expect(guessCasts('なし', casts)).toEqual([]);
  });

  it('サブフォルダごとに読み取り、キャストを推定し、取り込み済みを判別する。署名付きの認証で呼ぶ', async () => {
    await createCast(env.db, env.admin, B, { displayName: 'アスカ' });
    await createCast(env.db, env.admin, B, { displayName: 'アユナ' });
    const { f, calls } = fakeFetch();
    const p = await previewDriveImport(env.db, env.editorB, B, { folderUrl: `https://drive.google.com/drive/folders/${ROOT}`, group: 'subfolders' }, f);
    expect(p.rootName).toBe('2025 B-club');
    expect(p.entries.map((e) => [e.title, e.kind])).toEqual([['アスカ 春撮影', 'folder'], ['雑多', 'folder'], ['ayuna.png', 'file']]);
    const casts = await env.db.query<{ id: string; display_name: string }>('SELECT id, display_name FROM casts');
    const asuka = casts.find((c) => c.display_name === 'アスカ')!.id;
    expect(p.entries[0].suggestedCastIds).toEqual([asuka]);
    expect(p.entries[2].shotOn).toBe('2025-04-02'); // 撮影日(EXIF)を優先
    expect(p.entries[0].shotOn).toBe('2025-05-02'); // 作成日(UTC 5/1 15:30 = 日本時間 5/2)
    expect(calls.filter((c) => c.url === SA.token_uri)).toHaveLength(1); // トークンは使い回す
    expect(calls.filter((c) => c.auth).every((c) => c.auth === 'Bearer tok-1')).toBe(true);

    // 取り込み → 同じ内容を再度取り込んでも二重にならない
    const items = p.entries.map((e) => ({ externalId: e.id, title: e.title, url: e.url, mimeType: e.mimeType, shotOn: e.shotOn, castIds: e.suggestedCastIds, purpose: 'sns' }));
    expect(await importDriveItems(env.db, env.editorB, B, { items })).toEqual({ imported: 3, skipped: 0 });
    expect(await importDriveItems(env.db, env.editorB, B, { items })).toEqual({ imported: 0, skipped: 3 });
    const list = await listArchiveLinks(env.db, env.admin, B);
    expect(list).toHaveLength(3);
    expect(list.find((l) => l.title === 'アスカ 春撮影')).toMatchObject({ source: 'drive', cast_names: ['アスカ'], purpose: 'sns' });
    const p2 = await previewDriveImport(env.db, env.editorB, B, { folderUrl: ROOT, group: 'subfolders' }, f);
    expect(p2.entries.every((e) => e.alreadyImported)).toBe(true);
  });

  it('ファイルごとに再帰して読み取る（パスつき）', async () => {
    const { f } = fakeFetch();
    const p = await previewDriveImport(env.db, env.admin, B, { folderUrl: ROOT, group: 'files' }, f);
    expect(p.entries.map((e) => `${e.path}｜${e.title}`).sort()).toEqual(['2025 B-club / アスカ 春撮影｜a1.jpg', '2025 B-club / 雑多｜b1.mp4', '2025 B-club｜ayuna.png']);
  });

  it('共有されていない・フォルダでない・URL不正・権限なしは日本語エラー', async () => {
    const { f } = fakeFetch();
    await expect(previewDriveImport(env.db, env.admin, B, { folderUrl: 'NOPERMISSION_0000000000', group: 'files' }, f)).rejects.toThrow('robot@proj.iam.gserviceaccount.com');
    await expect(previewDriveImport(env.db, env.admin, B, { folderUrl: `https://drive.google.com/file/d/${FILE1}/view`, group: 'files' }, f)).rejects.toThrow('フォルダのURL');
    await expect(previewDriveImport(env.db, env.admin, B, { folderUrl: 'https://example.com/x', group: 'files' }, f)).rejects.toBeInstanceOf(AppError);
    await expect(previewDriveImport(env.db, env.viewerB, B, { folderUrl: ROOT, group: 'files' }, f)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(previewDriveImport(env.db, env.editorK, B, { folderUrl: ROOT, group: 'files' }, f)).rejects.toMatchObject({ code: 'not_found' });
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    await expect(previewDriveImport(env.db, env.admin, B, { folderUrl: ROOT, group: 'files' }, f)).rejects.toThrow('未設定');
  });

  it('取り込みはドライブ以外のURL・IDと食い違うURL・他店舗のキャストを拒否', async () => {
    const k = await createCast(env.db, env.admin, env.stores['kingyo'], { displayName: 'Kの子' });
    const ok = { externalId: 'ABCDEFGHIJ0123456789', title: 't', url: 'https://drive.google.com/file/d/ABCDEFGHIJ0123456789/view', castIds: [] as string[] };
    await expect(importDriveItems(env.db, env.admin, B, { items: [{ ...ok, url: 'https://evil.example.com/ABCDEFGHIJ0123456789' }] })).rejects.toBeInstanceOf(AppError);
    await expect(importDriveItems(env.db, env.admin, B, { items: [{ ...ok, url: 'https://drive.google.com/file/d/OTHERID0000000000000/view' }] })).rejects.toBeInstanceOf(AppError);
    await expect(importDriveItems(env.db, env.admin, B, { items: [{ ...ok, castIds: [k.id] }] })).rejects.toBeInstanceOf(AppError);
    await expect(importDriveItems(env.db, env.admin, B, { items: [] })).rejects.toBeInstanceOf(AppError);
    await expect(importDriveItems(env.db, env.viewerB, B, { items: [ok] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await importDriveItems(env.db, env.admin, B, { items: [ok] })).toEqual({ imported: 1, skipped: 0 });
  });

  it('サムネイルは認証付きで取得する。フォルダは中のファイルのサムネイルを代表にする', async () => {
    const { f, calls } = fakeFetch();
    const t = await fetchDriveThumbnail(FILE1, 400, f);
    expect(t?.type).toBe('image/jpeg');
    expect(calls.at(-1)).toMatchObject({ url: 'https://lh3.example.test/t=s400', auth: 'Bearer tok-1' });
    const t2 = await fetchDriveThumbnail(ROOT, 400, f);
    expect(t2).toBeNull(); // ルート直下に画像サムネイルを持つファイルが無い場合
  });
});
