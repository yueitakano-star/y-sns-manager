import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">遊栄 SNS素材・投稿管理</h1>
      <p className="mb-6 text-sm text-slate-600">社内業務用です。管理者から発行されたアカウントでログインしてください。</p>
      <div className="card">
        <LoginForm />
      </div>
      <p className="mt-4 text-xs text-slate-500">新規登録はできません。アカウントの発行・権限の付与は管理者が行います。</p>
    </main>
  );
}
