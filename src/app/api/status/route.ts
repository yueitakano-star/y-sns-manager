import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/session';
import { supabaseStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** 設定の反映確認用（値は返さず、設定されているかどうかだけ）。システム管理者のみ */
export async function GET() {
  const u = await currentUser();
  if (!u?.isSystemAdmin) return new NextResponse('forbidden', { status: 403 });
  return NextResponse.json({
    database: process.env.DATABASE_URL ? 'DATABASE_URL 設定あり' : '未設定（ローカルDB）',
    storage: supabaseStorage.configured() ? 'アップロード設定あり' : '未設定',
    supabaseUrlSet: !!process.env.SUPABASE_URL,
    serviceKeySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    noAuth: process.env.NO_AUTH === 'true',
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    vercelEnv: process.env.VERCEL_ENV ?? null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
  });
}
