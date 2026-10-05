import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { getStoreForActor, requireRole } from '@/lib/access';
import { AppError } from '@/lib/errors';
import { driveConfigured, fetchDriveThumbnail } from '@/lib/gdrive';

export const dynamic = 'force-dynamic';

/** 過去素材リンクのサムネイル。ログイン済みで、その店舗を見られる人だけに、サーバーがドライブから取得して返す */
export async function GET(_req: Request, { params }: { params: Promise<{ store: string; id: string }> }) {
  const { store: key, id } = await params;
  const user = await currentUser();
  if (!user) return new NextResponse('unauthorized', { status: 401 });
  if (!driveConfigured() || !/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('not found', { status: 404 });
  const db = await getDb();
  try {
    const store = await getStoreForActor(db, user, key);
    await requireRole(db, user, store.id, 'viewer');
    // 取得できるのは、この店舗に登録済みのドライブ由来リンクのIDだけ（任意のIDは取れない）
    const rows = await db.query<{ external_id: string }>(
      "SELECT external_id FROM archive_links WHERE id=$1 AND store_id=$2 AND voided_at IS NULL AND source='drive' AND external_id IS NOT NULL",
      [id, store.id],
    );
    if (!rows[0]) return new NextResponse('not found', { status: 404 });
    const t = await fetchDriveThumbnail(rows[0].external_id);
    if (!t) return new NextResponse('no thumbnail', { status: 404, headers: { 'Cache-Control': 'private, max-age=300' } });
    return new NextResponse(t.body, { headers: { 'Content-Type': t.type, 'Cache-Control': 'private, max-age=3600' } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse('error', { status: e.code === 'forbidden' || e.code === 'not_found' ? 403 : 502 });
    return new NextResponse('error', { status: 502 });
  }
}
