import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCast } from '../src/lib/domain/casts';
import { createArchiveLink, getArchiveLink, isDriveUrl, listArchiveLinks, updateArchiveLink, voidArchiveLink } from '../src/lib/domain/archive';
import { storeStats } from '../src/lib/domain/stats';
import { parsePeriod } from '../src/lib/jst';
import { resetData, setupEnv, type Env } from './helpers';
import { AppError } from '../src/lib/errors';

let env: Env;
let B: string;
let K: string;
beforeAll(async () => { env = await setupEnv(); B = env.stores['b-club']; K = env.stores['kingyo']; });
afterAll(async () => { await env.db.close(); });
beforeEach(async () => { await resetData(env.db); await env.db.exec('TRUNCATE archive_links CASCADE'); });

const drive = 'https://drive.google.com/drive/folders/abc123';
const rejects = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  return e as AppError;
};

describe('過去素材置き場（ドライブのリンク台帳）', () => {
  it('登録・編集・絞り込み・取消ができ、素材の在庫・使用数には影響しない', async () => {
    const a = await createCast(env.db, env.admin, B, { displayName: 'Aさん' });
    const r = await createArchiveLink(env.db, env.editorB, B, { title: '2025春 撮影まとめ', url: drive, castIds: [a.id], shotOn: '2025-04-01', purpose: 'sns', description: '元データ' });
    await createArchiveLink(env.db, env.editorB, B, { title: '店舗PR動画', url: 'https://example.com/x', castIds: [] });
    expect((await listArchiveLinks(env.db, env.viewerB, B)).map((x) => x.title).sort()).toEqual(['2025春 撮影まとめ', '店舗PR動画']);
    expect((await listArchiveLinks(env.db, env.admin, B, { castId: a.id })).map((x) => x.title)).toEqual(['2025春 撮影まとめ']);
    expect((await listArchiveLinks(env.db, env.admin, B, { common: true })).map((x) => x.title)).toEqual(['店舗PR動画']);
    expect((await listArchiveLinks(env.db, env.admin, B, { q: '元データ' })).length).toBe(1);
    expect((await listArchiveLinks(env.db, env.admin, B, { q: '100%' })).length).toBe(0); // %は文字として扱う
    expect((await listArchiveLinks(env.db, env.admin, B, { purpose: 'ad' })).length).toBe(0);
    // 在庫・使用数には含まれない
    expect((await storeStats(env.db, env.admin, B, parsePeriod({}))).items.total).toBe(0);
    await updateArchiveLink(env.db, env.editorB, B, r.id, { title: '改題', url: drive, castIds: [] });
    expect((await getArchiveLink(env.db, env.admin, B, r.id)).cast_names).toEqual([]);
    await voidArchiveLink(env.db, env.editorB, B, r.id, '重複');
    expect((await listArchiveLinks(env.db, env.admin, B)).length).toBe(1);
  });

  it('http/https以外・空・未来日は拒否。リクエストキーで二重登録しない', async () => {
    for (const url of ['javascript:alert(1)', 'ftp://x/y', 'drive.google.com/x', '']) {
      await rejects(createArchiveLink(env.db, env.admin, B, { title: 't', url }), 'validation');
    }
    await rejects(createArchiveLink(env.db, env.admin, B, { title: '', url: drive }), 'validation');
    await rejects(createArchiveLink(env.db, env.admin, B, { title: 't', url: drive, shotOn: '2099-01-01' }), 'validation');
    const k = 'archive-key-1234';
    const r1 = await createArchiveLink(env.db, env.admin, B, { requestKey: k, title: 't', url: drive });
    const r2 = await createArchiveLink(env.db, env.admin, B, { requestKey: k, title: 't', url: drive });
    expect(r2).toMatchObject({ id: r1.id, duplicate: true });
    expect((await listArchiveLinks(env.db, env.admin, B)).length).toBe(1);
  });

  it('店舗の分離と権限: 他店舗・閲覧専用・他店舗キャストは不可', async () => {
    const kCast = await createCast(env.db, env.admin, K, { displayName: 'Kの子' });
    await rejects(createArchiveLink(env.db, env.admin, B, { title: 't', url: drive, castIds: [kCast.id] }), 'validation');
    await rejects(createArchiveLink(env.db, env.viewerB, B, { title: 't', url: drive }), 'forbidden');
    await rejects(listArchiveLinks(env.db, env.editorK, B), 'not_found');
    const r = await createArchiveLink(env.db, env.admin, B, { title: 't', url: drive });
    await rejects(getArchiveLink(env.db, env.admin, K, r.id), 'not_found');
    await rejects(updateArchiveLink(env.db, env.admin, K, r.id, { title: 'x', url: drive }), 'not_found');
  });

  it('Googleドライブ系のURLを判定できる', () => {
    expect(isDriveUrl(drive)).toBe(true);
    expect(isDriveUrl('https://docs.google.com/document/d/x')).toBe(true);
    expect(isDriveUrl('https://example.com/drive.google.com')).toBe(false);
    expect(isDriveUrl('nonsense')).toBe(false);
  });
});
