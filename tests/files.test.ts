import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCast } from '../src/lib/domain/casts';
import { createMaterial, getBatchDetail } from '../src/lib/domain/materials';
import { listFiles, prepareUpload, registerFile, removeFile } from '../src/lib/domain/files';
import type { StorageApi } from '../src/lib/storage';
import { AppError } from '../src/lib/errors';
import { setupEnv, type Env } from './helpers';

let env: Env;
const removed: string[] = [];
const storage: StorageApi = {
  configured: () => true,
  createUploadUrl: async (p) => `https://example.test/upload/${p}`,
  createDownloadUrl: async (p) => `https://example.test/dl/${p}`,
  remove: async (p) => { removed.push(p); },
};
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env.db.close(); });

const setup = async (store: string, actor = env.admin) => {
  const c = await createCast(env.db, actor, store, { displayName: 'Aさん' });
  const b = await createMaterial(env.db, actor, store, { category: 'self_pr_image', mediaKind: 'image', quantity: 2, castIds: [c.id], shotOn: '2025-09-01', title: 'PR' });
  const items = (await getBatchDetail(env.db, actor, store, b.batchId)).items;
  return items;
};
const img = { name: 'a b.jpg', type: 'image/jpeg', size: 1000 };

describe('ファイルアップロード（記録・権限・検証）', () => {
  it('署名付きURL発行→登録→一覧→取り外しができる', async () => {
    const B = env.stores['b-club'];
    const [it] = await setup(B);
    const prep = await prepareUpload(env.db, storage, env.editorB, B, it.id, img);
    expect(prep.path.startsWith(`${B}/${it.id}/`)).toBe(true);
    const id = await registerFile(env.db, env.editorB, B, it.id, { ...img, path: prep.path });
    expect((await listFiles(env.db, env.viewerB, B, [it.id])).map((f) => f.id)).toEqual([id]);
    await removeFile(env.db, storage, env.editorB, B, id);
    expect(await listFiles(env.db, env.editorB, B, [it.id])).toHaveLength(0);
    expect(removed).toContain(prep.path);
  });
  it('形式・サイズ・空ファイルは拒否', async () => {
    const B = env.stores['b-club'];
    const [it] = await setup(B);
    for (const f of [{ name: 'x.exe', type: 'application/x-msdownload', size: 10 }, { name: 'big.mp4', type: 'video/mp4', size: 10 * 1024 * 1024 * 1024 }, { name: 'z.jpg', type: 'image/jpeg', size: 0 }]) {
      await expect(prepareUpload(env.db, storage, env.admin, B, it.id, f)).rejects.toBeInstanceOf(AppError);
    }
  });
  it('閲覧専用・他店舗の担当者・未設定ストレージは拒否', async () => {
    const B = env.stores['b-club'];
    const [it] = await setup(B);
    await expect(prepareUpload(env.db, storage, env.viewerB, B, it.id, img)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(prepareUpload(env.db, storage, env.editorK, B, it.id, img)).rejects.toMatchObject({ code: 'not_found' });
    await expect(prepareUpload(env.db, { ...storage, configured: () => false }, env.admin, B, it.id, img)).rejects.toMatchObject({ code: 'validation' });
  });
  it('他店舗・他素材のパスや別店舗の素材IDでは登録できない', async () => {
    const B = env.stores['b-club'];
    const K = env.stores['kingyo'];
    const [it] = await setup(B);
    const [kit] = await setup(K);
    await expect(registerFile(env.db, env.admin, B, it.id, { ...img, path: `${K}/${kit.id}/x.jpg` })).rejects.toMatchObject({ code: 'validation' });
    await expect(registerFile(env.db, env.admin, B, it.id, { ...img, path: `${B}/${it.id}/../../x.jpg` })).rejects.toMatchObject({ code: 'validation' });
    await expect(registerFile(env.db, env.admin, B, kit.id, { ...img, path: `${B}/${kit.id}/x.jpg` })).rejects.toMatchObject({ code: 'not_found' });
  });
});
