'use client';

import { prepareUploadAction, registerFileAction } from '@/app/actions';

/** 1ファイルをブラウザからストレージへ直接アップロードして登録する。失敗時はエラー文言、成功時は null */
export async function uploadOne(storeKey: string, itemId: string, file: File): Promise<string | null> {
  const meta = { name: file.name, type: file.type, size: file.size };
  try {
    const prep = await prepareUploadAction(storeKey, itemId, meta);
    if (!prep.ok) return prep.message;
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);
    const res = await fetch(prep.data.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form });
    if (!res.ok) return `「${file.name}」のアップロードに失敗しました（${res.status}）。`;
    const reg = await registerFileAction(storeKey, itemId, { ...meta, path: prep.data.path });
    return reg.ok ? null : reg.message;
  } catch {
    return `「${file.name}」のアップロード中に通信が失敗しました。もう一度お試しください。`;
  }
}
