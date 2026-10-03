import seed from '../../seed/APP_SEED.json';

export type MediaKind = 'image' | 'video' | 'other';
export type MaterialStatus = 'captured' | 'editing' | 'ready' | 'unusable';
export type PostStatus = 'draft' | 'scheduled' | 'published' | 'cancelled';
export type Platform = 'instagram' | 'tiktok' | 'other';
export type Role = 'admin' | 'editor' | 'viewer';
export type AnswerStatus = 'unanswered' | 'answered' | 'passed';

export type CategoryKey =
  | 'interview'
  | 'self_pr_image'
  | 'self_pr_video'
  | 'brand_video'
  | 'daily_photo'
  | 'event_material'
  | 'other';
export type PostCategoryKey = 'interview' | 'self_pr' | 'brand_video' | 'daily_photo' | 'other';

export const CATEGORIES = seed.material_categories as {
  key: CategoryKey;
  name: string;
  code: string;
  allowed_media_kinds: MediaKind[];
  default_post_category: PostCategoryKey;
  requires_question_set: boolean;
}[];
export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<
  CategoryKey,
  (typeof CATEGORIES)[number]
>;

export const UNIT: Record<MediaKind, string> = { image: '枚', video: '本', other: '点' };
export const MEDIA_LABEL: Record<MediaKind, string> = { image: '画像', video: '動画', other: 'その他' };

export const MATERIAL_STATES = seed.material_states as { key: MaterialStatus; name: string }[];
export const MATERIAL_STATE_LABEL = Object.fromEntries(MATERIAL_STATES.map((s) => [s.key, s.name])) as Record<
  MaterialStatus,
  string
>;

export const POST_CATEGORIES = seed.post_categories as { key: PostCategoryKey; name: string }[];
export const POST_CATEGORY_LABEL = Object.fromEntries(POST_CATEGORIES.map((c) => [c.key, c.name])) as Record<
  PostCategoryKey,
  string
>;

export const POST_STATES = seed.post_states as { key: PostStatus; name: string }[];
export const POST_STATE_LABEL = Object.fromEntries(POST_STATES.map((s) => [s.key, s.name])) as Record<
  PostStatus,
  string
>;

export const PLATFORMS = seed.platforms as { key: Platform; name: string }[];
export const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.key, p.name])) as Record<Platform, string>;

export const ROLE_LABEL: Record<Role, string> = { admin: '管理者', editor: '編集スタッフ', viewer: '閲覧のみ' };
export const ANSWER_LABEL: Record<AnswerStatus, string> = { unanswered: '未回答', answered: '回答済み', passed: 'パス' };

export const SET_COUNT = 20;
export const QUESTION_COUNT = 60;

export function setLabel(setNumber: number, title: string): string {
  return `SET ${String(setNumber).padStart(2, '0')}｜${title}`;
}
