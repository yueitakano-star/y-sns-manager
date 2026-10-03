import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { getStoreForActor } from '@/lib/access';
import { AppError } from '@/lib/errors';
import { castStats } from '@/lib/domain/stats';
import { listPickerItems } from '@/lib/domain/materials';
import { listPosts } from '@/lib/domain/posts';
import { CATEGORY_BY_KEY, MATERIAL_STATE_LABEL, PLATFORM_LABEL, POST_CATEGORY_LABEL, POST_STATE_LABEL } from '@/lib/constants';
import { formatJaDateTime, parsePeriod } from '@/lib/jst';
import { toCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ store: string; kind: string }> }) {
  const { store: key, kind } = await params;
  const user = await currentUser();
  if (!user) return new NextResponse('ログインが必要です', { status: 401 });
  const db = await getDb();
  try {
    const store = await getStoreForActor(db, user, key);
    let csv: string;
    if (kind === 'casts') {
      const rows = await castStats(db, user, store.id, parsePeriod({}));
      csv = toCsv(
        ['キャスト名', '在籍状態', '画像(枚)', '動画(本)', 'その他(点)', '使用済み素材', '未使用素材', '未使用・投稿可能', '完了セット/20', '回答質問/60', '撮影回数', '投稿済み', '投稿予定', '最終撮影日', '最終投稿日'],
        rows.map((r) => [r.display_name, r.status === 'active' ? '在籍' : '非表示・退店', r.images, r.videos, r.others, r.used_items, r.unused_items, r.unused_ready, r.done_sets, r.answered_questions, r.takes, r.published_posts, r.scheduled_posts, r.last_shot ?? '', r.last_published ? formatJaDateTime(r.last_published) : '']),
      );
    } else if (kind === 'materials') {
      const rows = await listPickerItems(db, user, store.id);
      csv = toCsv(
        ['素材番号', '素材グループ', '種類', '形式', '作業状態', '撮影・作成日', '出演キャスト', '投稿済み回数', '投稿予定の件数', '質問セット'],
        rows.map((r) => [r.code, r.batch_title, CATEGORY_BY_KEY[r.category].name, r.media_kind, MATERIAL_STATE_LABEL[r.status], r.shot_on, r.cast_names.join('・'), r.published_count, r.scheduled_count, r.set_label ?? '']),
      );
    } else if (kind === 'posts') {
      const rows = await listPosts(db, user, store.id);
      csv = toCsv(
        ['タイトル', '系統', '投稿先', '状態', '予定日時', '実投稿日時', '出演キャスト', '素材番号', '素材未紐付け', '投稿URL', '公開状態メモ'],
        rows.map((r) => [r.title, r.category === 'other' && r.other_label ? r.other_label : POST_CATEGORY_LABEL[r.category], PLATFORM_LABEL[r.platform], POST_STATE_LABEL[r.status], r.scheduled_at ? formatJaDateTime(r.scheduled_at) : '', r.published_at ? formatJaDateTime(r.published_at) : '', r.cast_names.join('・'), r.item_codes.join(' '), r.material_count === 0 ? '○' : '', r.url ?? '', r.public_state_note ?? '']),
      );
    } else {
      return new NextResponse('not found', { status: 404 });
    }
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${store.key}-${kind}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse('権限がありません', { status: 403 });
    throw e;
  }
}
