import crypto from 'node:crypto';
import type { Db, Queryable } from './db';
import type { Role } from './constants';
import { AppError, validation } from './errors';
import type { Actor } from './access';

const SESSION_DAYS = 14;

export interface SessionUser extends Actor {
  email: string | null;
  displayName: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return 'パスワードは10文字以上にしてください。';
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// 連続失敗でアカウントを一時ロック（DBに保存するのでサーバーレスの複数インスタンスでも有効）
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export function normalizeLoginName(name: string): string {
  return name.trim().normalize('NFKC');
}

export function validatePin(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return 'PINは4〜8桁の数字にしてください。';
  return null;
}

/** メール+パスワード、または 名前+PIN で認証し、セッショントークン(生値)を返す */
export async function login(db: Db, identifierRaw: string, secret: string): Promise<{ token: string; expires: Date }> {
  const identifier = identifierRaw.trim();
  const byEmail = identifier.includes('@');
  const rows = await db.query<{ id: string; password_hash: string; is_active: boolean; failed_count: number; locked: boolean }>(
    `SELECT id, password_hash, is_active, failed_count, (locked_until IS NOT NULL AND locked_until > now()) AS locked
       FROM users WHERE ${byEmail ? 'email = $1' : 'login_name = $1'}`,
    [byEmail ? normalizeEmail(identifier) : normalizeLoginName(identifier)],
  );
  const u = rows[0];
  if (u?.locked) {
    throw new AppError('forbidden', `失敗が続いたため一時的にロックしています。${LOCK_MINUTES}分ほど待ってからやり直してください。`);
  }
  const ok = u ? verifyPassword(secret, u.password_hash) : (verifyPassword(secret, 'scrypt$00$00'), false);
  if (!u || !ok || !u.is_active) {
    if (u) {
      await db.query(
        `UPDATE users SET failed_count = failed_count + 1,
                locked_until = CASE WHEN failed_count + 1 >= $2 THEN now() + make_interval(mins => $3::int) ELSE locked_until END
          WHERE id = $1`,
        [u.id, MAX_FAILS, LOCK_MINUTES],
      );
    }
    throw new AppError('unauthenticated', '名前（メール）またはパスワード（PIN）が正しくありません。');
  }
  await db.query('UPDATE users SET failed_count = 0, locked_until = NULL WHERE id = $1', [u.id]);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), u.id, expires.toISOString()]);
  return { token, expires };
}

export async function getSessionUser(q: Queryable, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await q.query<{ id: string; email: string | null; display_name: string; is_system_admin: boolean }>(
    `SELECT u.id, u.email, u.display_name, u.is_system_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [sha256(token)],
  );
  const u = rows[0];
  if (!u) return null;
  return { userId: u.id, email: u.email, displayName: u.display_name, isSystemAdmin: u.is_system_admin };
}

export async function logout(q: Queryable, token: string | undefined): Promise<void> {
  if (token) await q.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export interface NewUser {
  /** メール+パスワードで入る人 */
  email?: string;
  password?: string;
  /** 名前+PINで入る担当者 */
  loginName?: string;
  pin?: string;
  displayName: string;
  isSystemAdmin?: boolean;
  memberships?: { storeId: string; role: Role }[];
}

/** 管理者による招待（アカウント作成＋店舗権限付与）。自己登録の経路は存在しない */
export async function createUser(db: Db, input: NewUser): Promise<string> {
  const email = input.email ? normalizeEmail(input.email) : null;
  const loginName = input.loginName ? normalizeLoginName(input.loginName) : null;
  let secret: string;
  if (loginName) {
    if (loginName.includes('@')) throw validation('名前に @ は使えません。', { loginName: '@ は使えません。' });
    const e = validatePin(input.pin ?? '');
    if (e) throw validation(e, { pin: e });
    secret = input.pin as string;
  } else {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validation('メールアドレスの形式が正しくありません。', { email: '形式が正しくありません。' });
    const pwErr = validatePasswordStrength(input.password ?? '');
    if (pwErr) throw validation(pwErr, { password: pwErr });
    secret = input.password as string;
  }
  const displayName = (input.displayName || loginName || '').trim();
  if (!displayName) throw validation('表示名を入力してください。', { displayName: '入力してください。' });
  return db.tx(async (q) => {
    if (email && (await q.query('SELECT 1 FROM users WHERE email = $1', [email])).length) throw validation('このメールアドレスは既に登録されています。', { email: '既に登録されています。' });
    if (loginName && (await q.query('SELECT 1 FROM users WHERE login_name = $1', [loginName])).length) throw validation('この名前は既に使われています。', { loginName: '既に使われています。' });
    const rows = await q.query<{ id: string }>(
      `INSERT INTO users(email, login_name, display_name, password_hash, is_system_admin) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [email, loginName, displayName, hashPassword(secret), !!input.isSystemAdmin],
    );
    for (const m of input.memberships ?? []) {
      await q.query('INSERT INTO user_store_memberships(user_id, store_id, role) VALUES ($1,$2,$3)', [rows[0].id, m.storeId, m.role]);
    }
    return rows[0].id;
  });
}

/** PINの再設定（管理者用）。ロックも解除する */
export async function setPin(q: Queryable, userId: string, pin: string): Promise<void> {
  const e = validatePin(pin);
  if (e) throw validation(e, { pin: e });
  const r = await q.query('UPDATE users SET password_hash = $2, failed_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1 AND login_name IS NOT NULL RETURNING id', [userId, hashPassword(pin)]);
  if (!r.length) throw validation('PINログインのユーザーではありません。');
}

export async function setMembership(q: Queryable, userId: string, storeId: string, role: Role | null): Promise<void> {
  if (role === null) {
    await q.query('DELETE FROM user_store_memberships WHERE user_id = $1 AND store_id = $2', [userId, storeId]);
    return;
  }
  await q.query(
    `INSERT INTO user_store_memberships(user_id, store_id, role) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, store_id) DO UPDATE SET role = EXCLUDED.role`,
    [userId, storeId, role],
  );
}
