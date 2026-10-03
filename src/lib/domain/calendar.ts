import type { Queryable } from '../db';
import type { Actor } from '../access';
import { requireRole } from '../access';
import { CATEGORY_BY_KEY, POST_CATEGORY_LABEL, PLATFORM_LABEL, UNIT, setLabel, type CategoryKey, type MediaKind, type Platform, type PostCategoryKey } from '../constants';
import { addDays, jstDate, jstDayStart, jstTime } from '../jst';

export type CalKind = 'interview' | 'material' | 'scheduled' | 'published';

export interface CalEvent {
  key: string;
  date: string; // 日本時間の日付
  kind: CalKind;
  /** 例: 「Aさん」「店舗共通」 */
  who: string;
  castIds: string[];
  /** 例: 「SET 01｜まずは、どんな子？」「セルフPR画像」「インタビュー」 */
  what: string;
  /** 例: 「回答 2/3問（撮影日）」「10枚」「Instagram 19:30」 */
  detail: string;
  time: string | null;
  platform: Platform | null;
  href: string;
  /** 予定からずれた履歴など詳細に出す補足 */
  note?: string;
}

export interface CalFilter {
  castId?: string;
  kinds?: CalKind[];
  platform?: string;
}

const KIND_ORDER: Record<CalKind, number> = { interview: 0, material: 1, scheduled: 2, published: 3 };

/** 保存済みレコードから生成するカレンダーイベント（独立した台帳は持たない）。 fromDate/toDate は日本時間の日付(両端含む) */
export async function calendarEvents(
  q: Queryable,
  actor: Actor,
  storeId: string,
  fromDate: string,
  toDate: string,
  base: string,
  f: CalFilter = {},
): Promise<CalEvent[]> {
  await requireRole(q, actor, storeId, 'viewer');
  const kinds = new Set<CalKind>(f.kinds?.length ? f.kinds : ['interview', 'material', 'scheduled', 'published']);
  const from = jstDayStart(fromDate);
  const to = jstDayStart(addDays(toDate, 1));
  const events: CalEvent[] = [];

  if (kinds.has('interview')) {
    const shoots = await q.query<{ batch_id: string | null; shot_on: string; set_number: number; title: string; cast_id: string; cast_name: string }>(
      `SELECT s.batch_id, s.shot_on::text AS shot_on, qs.set_number, qs.title, pa.cast_id, c.display_name AS cast_name
         FROM interview_sessions s
         JOIN interview_participants pa ON pa.session_id = s.id
         JOIN casts c ON c.id = pa.cast_id
         JOIN question_sets qs ON qs.id = s.question_set_id
        WHERE s.store_id = $1 AND s.voided_at IS NULL AND s.shot_on BETWEEN $2::date AND $3::date`,
      [storeId, fromDate, toDate],
    );
    const answers = await q.query<{ batch_id: string | null; shot_on: string; answered_on: string; set_number: number; title: string; cast_id: string; cast_name: string; question_id: string }>(
      `SELECT s.batch_id, s.shot_on::text AS shot_on, a.answered_on::text AS answered_on, qs.set_number, qs.title,
              a.cast_id, c.display_name AS cast_name, a.question_id
         FROM answer_records a
         JOIN interview_sessions s ON s.id = a.session_id
         JOIN casts c ON c.id = a.cast_id
         JOIN questions qu ON qu.id = a.question_id
         JOIN question_sets qs ON qs.id = qu.question_set_id
        WHERE a.store_id = $1 AND a.voided_at IS NULL AND s.voided_at IS NULL AND a.status = 'answered'
          AND a.answered_on BETWEEN $2::date AND $3::date`,
      [storeId, fromDate, toDate],
    );
    interface Card { date: string; castId: string; castName: string; setNumber: number; title: string; batchId: string | null; shoot: boolean; qs: Set<string> }
    const cards = new Map<string, Card>();
    const get = (date: string, r: { cast_id: string; cast_name: string; set_number: number; title: string; batch_id: string | null }): Card => {
      const k = `${date}|${r.cast_id}|${r.set_number}`;
      let c = cards.get(k);
      if (!c) {
        c = { date, castId: r.cast_id, castName: r.cast_name, setNumber: r.set_number, title: r.title, batchId: r.batch_id, shoot: false, qs: new Set() };
        cards.set(k, c);
      }
      return c;
    };
    for (const s of shoots) get(s.shot_on, s).shoot = true;
    for (const a of answers) {
      const c = get(a.answered_on, a);
      c.qs.add(a.question_id);
      if (a.answered_on === a.shot_on) c.shoot = true; // 撮影日当日の回答は撮影カードに集約
    }
    for (const [k, c] of cards) {
      events.push({
        key: `iv:${k}`,
        date: c.date,
        kind: 'interview',
        who: c.castName,
        castIds: [c.castId],
        what: setLabel(c.setNumber, c.title),
        detail: `${c.shoot ? '撮影' : '後日回答'} ・ 回答 ${c.qs.size}/3問`,
        time: null,
        platform: null,
        href: c.batchId ? `${base}/materials/${c.batchId}` : `${base}/casts/${c.castId}`,
      });
    }
  }

  if (kinds.has('material')) {
    const rows = await q.query<{ id: string; category: CategoryKey; other_label: string | null; media_kind: MediaKind; title: string; shot_on: string; n: number; cast_ids: string[]; cast_names: string[]; display_code: string }>(
      `SELECT b.id, b.category, b.other_label, b.media_kind, b.title, b.shot_on::text AS shot_on, b.display_code,
              (SELECT count(*)::int FROM material_items i WHERE i.batch_id = b.id AND i.voided_at IS NULL) AS n,
              coalesce((SELECT array_agg(DISTINCT c.id) FROM material_items i JOIN material_item_casts ic ON ic.item_id = i.id JOIN casts c ON c.id = ic.cast_id WHERE i.batch_id = b.id AND i.voided_at IS NULL), ARRAY[]::uuid[]) AS cast_ids,
              coalesce((SELECT array_agg(DISTINCT c.display_name) FROM material_items i JOIN material_item_casts ic ON ic.item_id = i.id JOIN casts c ON c.id = ic.cast_id WHERE i.batch_id = b.id AND i.voided_at IS NULL), ARRAY[]::text[]) AS cast_names
         FROM material_batches b
        WHERE b.store_id = $1 AND b.voided_at IS NULL AND b.category <> 'interview' AND b.shot_on BETWEEN $2::date AND $3::date`,
      [storeId, fromDate, toDate],
    );
    for (const r of rows) {
      const cat = CATEGORY_BY_KEY[r.category];
      events.push({
        key: `mt:${r.id}`,
        date: r.shot_on,
        kind: 'material',
        who: r.cast_names.length ? r.cast_names.join('・') : '店舗共通',
        castIds: r.cast_ids,
        what: r.category === 'other' && r.other_label ? `${cat.name}（${r.other_label}）` : cat.name,
        detail: `${r.n}${UNIT[r.media_kind]}（${r.display_code}）`,
        time: null,
        platform: null,
        href: `${base}/materials/${r.id}`,
      });
    }
  }

  if (kinds.has('scheduled') || kinds.has('published')) {
    const want = [...kinds].filter((k) => k === 'scheduled' || k === 'published');
    const rows = await q.query<{ id: string; status: 'scheduled' | 'published'; category: PostCategoryKey; other_label: string | null; platform: Platform; title: string; scheduled_at: string | null; published_at: string | null; original_scheduled_at: string | null; cast_ids: string[]; cast_names: string[] }>(
      `SELECT p.id, p.status, p.category, p.other_label, p.platform, p.title, p.scheduled_at, p.published_at, p.original_scheduled_at,
              coalesce((SELECT array_agg(c.id) FROM post_casts pc JOIN casts c ON c.id = pc.cast_id WHERE pc.post_id = p.id), ARRAY[]::uuid[]) AS cast_ids,
              coalesce((SELECT array_agg(c.display_name ORDER BY c.display_name) FROM post_casts pc JOIN casts c ON c.id = pc.cast_id WHERE pc.post_id = p.id), ARRAY[]::text[]) AS cast_names
         FROM posts p
        WHERE p.store_id = $1 AND p.voided_at IS NULL AND p.status = ANY($4::text[])
          AND ((p.status = 'scheduled' AND p.scheduled_at >= $2::timestamptz AND p.scheduled_at < $3::timestamptz)
            OR (p.status = 'published' AND p.published_at >= $2::timestamptz AND p.published_at < $3::timestamptz))`,
      [storeId, from, to, want],
    );
    for (const r of rows) {
      if (f.platform && r.platform !== f.platform) continue;
      const at = (r.status === 'published' ? r.published_at : r.scheduled_at) as string;
      const cat = r.category === 'other' && r.other_label ? r.other_label : POST_CATEGORY_LABEL[r.category];
      let note: string | undefined;
      if (r.status === 'published' && r.original_scheduled_at && jstDate(r.original_scheduled_at) !== jstDate(at)) {
        note = `当初の予定日: ${jstDate(r.original_scheduled_at)}`;
      }
      events.push({
        key: `po:${r.id}`,
        date: jstDate(at),
        kind: r.status,
        who: r.cast_names.length ? r.cast_names.join('・') : '店舗共通',
        castIds: r.cast_ids,
        what: `${cat} ・ ${r.title}`,
        detail: `${PLATFORM_LABEL[r.platform]} ${jstTime(at)}`,
        time: jstTime(at),
        platform: r.platform,
        href: `${base}/posts/${r.id}`,
        note,
      });
    }
  }

  const out = f.castId ? events.filter((e) => e.castIds.includes(f.castId as string)) : events;
  return out.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.time ?? '').localeCompare(b.time ?? ''));
}
