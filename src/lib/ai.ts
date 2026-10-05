import { z } from 'zod';
import { AppError } from './errors';

/** Gemini でキャプション案を作る（キーはサーバー専用。画像は送らず、入力した文章と店舗名・投稿先などだけを送る） */
export const aiConfigured = () => !!process.env.GEMINI_API_KEY;

export const requestSchema = z.object({
  platform: z.enum(['instagram', 'tiktok', 'other']).default('instagram'),
  category: z.string().max(60).nullish(),
  title: z.string().max(200).nullish(),
  castNames: z.array(z.string().max(60)).max(10).default([]),
  draft: z.string({ error: '元になる文章を入力してください。' }).trim().min(1, '元になる文章を入力してください。').max(2000, '文章は2000文字以内にしてください。'),
  tone: z.enum(['energetic', 'elegant', 'casual', 'stylish', 'notice']).default('casual'),
  length: z.enum(['short', 'normal', 'long']).default('normal'),
  hashtags: z.boolean().default(true),
});
export type CaptionRequest = z.input<typeof requestSchema>;

export interface CaptionCandidate {
  label: string;
  caption: string;
}

const TONE: Record<string, string> = {
  energetic: '元気で明るい',
  elegant: '上品で落ち着いた',
  casual: '親しみやすくカジュアル',
  stylish: 'おしゃれで洗練された',
  notice: 'お知らせ向けの端的で分かりやすい',
};
const LENGTH: Record<string, string> = { short: '60文字前後の短め', normal: '120〜200文字程度', long: '300文字前後の長め' };
const PLATFORM: Record<string, string> = {
  instagram: 'Instagramの投稿キャプション（冒頭1〜2行で目を引く。改行や絵文字を適度に使う）',
  tiktok: 'TikTokの動画キャプション（短く、テンポよく。冒頭で引きを作る）',
  other: 'SNSの投稿文',
};

const SYSTEM = `あなたは飲食・接客業の店舗SNS運用を手伝う日本語のコピーライターです。
守ること:
- 元の文章に書かれていない事実（料金・日時・場所・人数・効能・順位・割引など）を作らない。不明な点は書かないか、【ここに記入】のように空欄の目印にする。
- キャストの本名・年齢・連絡先・住所など個人が特定できる情報、他者の悪口、過度な誇張、飲酒の強要を連想させる表現は書かない。
- 出力は必ず次のJSONのみ（説明文やコードブロックは付けない）:
{"candidates":[{"label":"案の特徴を短く(例: 元気め)","caption":"キャプション本文"}]}
- candidates は3件。それぞれ書き出しと雰囲気を変える。`;

function buildPrompt(r: z.output<typeof requestSchema>, storeName: string): string {
  const parts = [
    `店舗: ${storeName}`,
    `投稿先: ${PLATFORM[r.platform]}`,
    r.category ? `投稿の系統: ${r.category}` : '',
    r.title ? `投稿タイトル: ${r.title}` : '',
    r.castNames.length ? `出演: ${r.castNames.join('、')}` : '出演: 店舗共通',
    `文体: ${TONE[r.tone]}`,
    `長さ: ${LENGTH[r.length]}`,
    r.hashtags ? 'ハッシュタグ: 本文の末尾に関連するものを3〜8個付ける' : 'ハッシュタグ: 付けない',
    '',
    '【元になる文章（これを整えて・膨らませて）】',
    r.draft,
  ];
  return parts.filter((x) => x !== '').join('\n');
}

// 1ユーザーあたり1分に10回まで（誤操作・使い過ぎによる課金を防ぐ）
const hits = new Map<string, number[]>();
export function checkAiRate(userId: string, now = Date.now()): void {
  const arr = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= 10) throw new AppError('forbidden', 'AIの呼び出しが多すぎます。1分ほど待ってからお試しください。');
  arr.push(now);
  hits.set(userId, arr);
}

const responseSchema = z.object({ candidates: z.array(z.object({ label: z.string().max(40).default(''), caption: z.string().min(1).max(4000) })).min(1).max(5) });

export async function generateCaptions(input: unknown, storeName: string, fetchImpl: typeof fetch = fetch): Promise<CaptionCandidate[]> {
  if (!aiConfigured()) throw new AppError('validation', 'AIが未設定です（環境変数 GEMINI_API_KEY を設定して再デプロイしてください）。');
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError('validation', first?.message ?? '入力内容を確認してください。', { draft: first?.message ?? '' });
  }
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  let res: Response;
  try {
    res = await fetchImpl(`${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY as string },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: buildPrompt(parsed.data, storeName) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.9, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(40_000),
      cache: 'no-store',
    });
  } catch {
    throw new AppError('validation', 'AIに接続できませんでした。通信状況を確認して、もう一度お試しください。');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new AppError('validation', `AIの呼び出しに失敗しました（${res.status}）${body?.error?.message ? `: ${body.error.message.slice(0, 160)}` : ''}`);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new AppError('validation', data.promptFeedback?.blockReason ? 'AIが安全のため回答しませんでした。文章を変えてお試しください。' : 'AIから回答が返りませんでした。もう一度お試しください。');
  try {
    const json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    return responseSchema.parse(json).candidates.map((c, i) => ({ label: c.label || `案${i + 1}`, caption: c.caption.trim() }));
  } catch {
    throw new AppError('validation', 'AIの回答を読み取れませんでした。もう一度お試しください。');
  }
}
