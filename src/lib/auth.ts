import crypto from 'node:crypto';
import type { Db, Queryable } from './db';
import type { Role } from './constants';
import { AppError, validation } from './errors';
import type { Actor } from './access';

const SESSION_DAYS = 14;

export interface SessionUser extends Actor {
  email: string;
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

// ログイン試行の簡易レート制限（メール単位・プロセス内）。本番で複数インスタンスなら前段のWAF等も併用すること
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function checkRate(key: string): void {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && now - a.first < WINDOW_MS && a.count >= MAX_ATTEMPTS) {
    throw new AppError('forbidden', 'ログインの試行回数が上限に達しました。しばらく待ってからやり直してください。');
  }
}
function recordFailure(key: string): void {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first >= WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else a.count += 1;
}

/** メール+パスワードで認証し、セッショントークン(生値)を返す */
export async function login(db: Db, emailRaw: string, password: string): Promise<{ token: string; expires: Date }> {
  const email = normalizeEmail(emailRaw);
  checkRate(email);
  const rows = await db.query<{ id: string; password_hash: string; is_active: boolean }>(
    'SELECT id, password_hash, is_active FROM users WHERE email = $1',
    [email],
  );
  const u = rows[0];
  const ok = u ? verifyPassword(password, u.password_hash) : (verifyPassword(password, 'scrypt$00$00'), false);
  if (!u || !ok || !u.is_active) {
    recordFailure(email);
    throw new AppError('unauthenticated', 'メールアドレスまたはパスワードが正しくありません。');
  }
  attempts.delete(email);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.query('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [
    sha256(token),
    u.id,
    expires.toISOString(),
  ]);
  return { token, expires };
}

export async function getSessionUser(q: Queryable, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await q.query<{ id: string; email: string; display_name: string; is_system_admin: boolean }>(
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
  email: string;
  displayName: string;
  password: string;
  isSystemAdmin?: boolean;
  memberships?: { storeId: string; role: Role }[];
}

/** 管理者による招待（アカウント作成＋店舗権限付与）。自己登録の経路は存在しない */
export async function createUser(db: Db, input: NewUser): Promise<string> {
  const email = normalizeEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validation('メールアドレスの形式が正しくありません。', { email: '形式が正しくありません。' });
  const pwErr = validatePasswordStrength(input.password);
  if (pwErr) throw validation(pwErr, { password: pwErr });
  if (!input.displayName.trim()) throw validation('表示名を入力してください。', { displayName: '入力してください。' });
  return db.tx(async (q) => {
    const exists = await q.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (exists.length) throw validation('このメールアドレスは既に登録されています。', { email: '既に登録されています。' });
    const rows = await q.query<{ id: string }>(
      `INSERT INTO users(email, display_name, password_hash, is_system_admin) VALUES ($1,$2,$3,$4) RETURNING id`,
      [email, input.displayName.trim(), hashPassword(input.password), !!input.isSystemAdmin],
    );
    for (const m of input.memberships ?? []) {
      await q.query('INSERT INTO user_store_memberships(user_id, store_id, role) VALUES ($1,$2,$3)', [
        rows[0].id,
        m.storeId,
        m.role,
      ]);
    }
    return rows[0].id;
  });
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
