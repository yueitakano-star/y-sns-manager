import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, login, setPin, getSessionUser } from '../src/lib/auth';
import { AppError } from '../src/lib/errors';
import { setupEnv, type Env } from './helpers';

let env: Env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env.db.close(); });

describe('名前+PINログイン', () => {
  it('名前+PINでログインでき、メール+パスワードも従来どおり使える', async () => {
    const id = await createUser(env.db, { loginName: '田中', pin: '123456', displayName: '田中', memberships: [{ storeId: env.stores['b-club'], role: 'editor' }] });
    const r = await login(env.db, '田中', '123456');
    expect((await getSessionUser(env.db, r.token))?.userId).toBe(id);
    expect((await login(env.db, ' admin@example.com ', 'password-1234')).token).toBeTruthy();
  });
  it('PINは4〜8桁の数字のみ。名前の重複・@含みは拒否', async () => {
    for (const pin of ['123', '123456789', 'abcd', '12 34']) await expect(createUser(env.db, { loginName: 'x1', pin, displayName: 'x' })).rejects.toBeInstanceOf(AppError);
    await expect(createUser(env.db, { loginName: '田中', pin: '1111', displayName: 'x' })).rejects.toBeInstanceOf(AppError);
    await expect(createUser(env.db, { loginName: 'a@b', pin: '1111', displayName: 'x' })).rejects.toBeInstanceOf(AppError);
  });
  it('5回連続で間違えるとロックされ、正しいPINでも入れない。再設定で解除', async () => {
    const id = await createUser(env.db, { loginName: '佐藤', pin: '2468', displayName: '佐藤' });
    for (let i = 0; i < 5; i++) await expect(login(env.db, '佐藤', '0000')).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(login(env.db, '佐藤', '2468')).rejects.toMatchObject({ code: 'forbidden' });
    await setPin(env.db, id, '1357');
    expect((await login(env.db, '佐藤', '1357')).token).toBeTruthy();
  });
  it('無効化されたユーザーは入れない', async () => {
    const id = await createUser(env.db, { loginName: '鈴木', pin: '9999', displayName: '鈴木' });
    await env.db.query('UPDATE users SET is_active=false WHERE id=$1', [id]);
    await expect(login(env.db, '鈴木', '9999')).rejects.toBeInstanceOf(AppError);
  });
});
