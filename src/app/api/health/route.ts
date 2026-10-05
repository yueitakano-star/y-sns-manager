import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** 接続診断用。段階ごとの成否と、秘密を伏せたエラーの要点だけを返す（値や接続文字列は返さない） */
function safe(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const msg = String(err?.message ?? e)
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, '[接続文字列]')
    .replace(/password[^\s,;]*/gi, 'password[伏せ]')
    .slice(0, 200);
  return `${err?.code ? `[${err.code}] ` : ''}${msg}`;
}

export async function GET() {
  const steps: { step: string; ok: boolean; ms: number; error?: string }[] = [];
  const run = async (step: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    try {
      await fn();
      steps.push({ step, ok: true, ms: Date.now() - t });
      return true;
    } catch (e) {
      steps.push({ step, ok: false, ms: Date.now() - t, error: safe(e) });
      return false;
    }
  };
  let db: Awaited<ReturnType<typeof getDb>> | null = null;
  if (await run('DB接続・初期化', async () => { db = await getDb(); })) {
    const d = db as unknown as Awaited<ReturnType<typeof getDb>>;
    await run('店舗の読み込み', async () => { await d.query('SELECT count(*) FROM stores'); });
    await run('質問・クイズの読み込み', async () => { await d.query('SELECT (SELECT count(*) FROM questions) + (SELECT count(*) FROM quiz_questions)'); });
  }
  return NextResponse.json(
    {
      ok: steps.every((s) => s.ok),
      region: process.env.VERCEL_REGION ?? null,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
      env: {
        DATABASE_URL: !!process.env.DATABASE_URL,
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
        NO_AUTH: process.env.NO_AUTH === 'true',
      },
      steps,
    },
    { status: steps.every((s) => s.ok) ? 200 : 500, headers: { 'Cache-Control': 'no-store' } },
  );
}
