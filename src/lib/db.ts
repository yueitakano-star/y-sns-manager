import fs from 'node:fs';
import path from 'node:path';

/** SQLを実行できる最小インターフェース（トランザクション内でも共通） */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 複数文のSQL（パラメータなし）を実行 */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** timestamptz を常にISO文字列(UTC)で返す。 '2026-10-03 12:00:00+00' → '2026-10-03T12:00:00.000Z' */
export function parseTimestamp(v: string): string {
  let s = v.replace(' ', 'T');
  if (/[+-]\d\d$/.test(s)) s += ':00';
  if (!/(Z|[+-]\d\d:\d\d)$/.test(s)) s += 'Z';
  return new Date(s).toISOString();
}

const TS_OIDS = [1184, 1114];
const DATE_OID = 1082;
const INT8_OID = 20;
const NUMERIC_OID = 1700;

async function createPglite(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const parsers: Record<number, (v: string) => unknown> = {
    [DATE_OID]: (v) => v,
    [INT8_OID]: (v) => Number(v),
    [NUMERIC_OID]: (v) => Number(v),
  };
  for (const o of TS_OIDS) parsers[o] = parseTimestamp;
  const isMemory = dir.startsWith('memory://');
  if (!isMemory) fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
  const pg = await PGlite.create(isMemory ? undefined : path.resolve(dir), { parsers });
  type Tx = {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    exec: (sql: string) => Promise<unknown>;
  };
  const wrap = (c: Tx): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      return (await c.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await c.exec(sql);
    },
  });
  return {
    ...wrap(pg as unknown as Tx),
    async tx(fn) {
      return pg.transaction(async (t) => fn(wrap(t as unknown as Tx)));
    },
    async close() {
      await pg.close();
    },
  };
}

async function createPg(url: string): Promise<Db> {
  const pgMod = await import('pg');
  const { Pool, types } = pgMod.default ?? pgMod;
  const pool = new Pool({
    connectionString: url,
    max: 5,
    options: '-c timezone=UTC',
    ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  });
  // 型パーサーはPool単位で指定できないためグローバルに設定
  types.setTypeParser(DATE_OID, (v: string) => v);
  for (const o of TS_OIDS) types.setTypeParser(o, parseTimestamp);
  types.setTypeParser(INT8_OID, (v: string) => Number(v));
  types.setTypeParser(NUMERIC_OID, (v: string) => Number(v));
  const wrap = (c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      return (await c.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await c.query(sql);
    },
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn(wrap(client));
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function createDb(opts: { url?: string; pgliteDir?: string } = {}): Promise<Db> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    if (/\[YOUR-PASSWORD\]|YOUR_PASSWORD/.test(url)) throw new Error('DATABASE_URL のパスワード部分が置き換わっていません（[YOUR-PASSWORD] のままです）');
    return createPg(url);
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL が未設定です（Vercel の環境変数に追加して再デプロイしてください）');
  return createPglite(opts.pgliteDir ?? process.env.PGLITE_DIR ?? './.data/pglite');
}

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

/** 未適用のマイグレーションを順に適用する（適用済みはスキップ） */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const done: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    await db.tx(async (q) => {
      await q.exec(sql);
      await q.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
    done.push(f);
  }
  return done;
}

interface SeedJson {
  stores: { key: string; name: string; code: string; sort_order: number }[];
  question_sets: {
    key: string;
    set_number: number;
    version: number;
    title: string;
    questions: { key: string; position: number; text: string }[];
  }[];
}

/** 初期マスター(3店舗・20セット60問)を安定keyで冪等に投入。既存の実績は一切削除しない */
export async function seedMaster(db: Db): Promise<void> {
  const seed = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'seed', 'APP_SEED.json'), 'utf8')) as SeedJson;
  await db.tx(async (q) => {
    for (const s of seed.stores) {
      await q.query(
        `INSERT INTO stores(key, name, code, sort_order) VALUES ($1,$2,$3,$4)
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code, sort_order = EXCLUDED.sort_order`,
        [s.key, s.name, s.code, s.sort_order],
      );
    }
    for (const qs of seed.question_sets) {
      const rows = await q.query<{ id: string }>(
        `INSERT INTO question_sets(key, set_number, version, title) VALUES ($1,$2,$3,$4)
         ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
        [qs.key, qs.set_number, qs.version, qs.title],
      );
      for (const qu of qs.questions) {
        await q.query(
          `INSERT INTO questions(key, question_set_id, position, text) VALUES ($1,$2,$3,$4)
           ON CONFLICT (key) DO UPDATE SET text = EXCLUDED.text`,
          [qu.key, rows[0].id, qu.position, qu.text],
        );
      }
    }
  });
  await seedQuiz(db);
}

interface QuizSeed {
  quiz_sets: {
    key: string;
    set_number: number;
    version: number;
    title: string;
    comment_template: string;
    memo: string;
    reference: string;
    questions: { key: string; position: number; level: string; text: string; answer: string }[];
  }[];
}

/** クイズ集(20セット×5問)を安定keyで冪等に投入 */
export async function seedQuiz(db: Db): Promise<void> {
  const file = path.join(process.cwd(), 'seed', 'QUIZ_SEED.json');
  if (!fs.existsSync(file)) return;
  const seed = JSON.parse(fs.readFileSync(file, 'utf8')) as QuizSeed;
  await db.tx(async (q) => {
    for (const s of seed.quiz_sets) {
      const rows = await q.query<{ id: string }>(
        `INSERT INTO quiz_sets(key, set_number, version, title, comment_template, memo, reference) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, comment_template = EXCLUDED.comment_template, memo = EXCLUDED.memo, reference = EXCLUDED.reference RETURNING id`,
        [s.key, s.set_number, s.version, s.title, s.comment_template, s.memo, s.reference],
      );
      for (const qu of s.questions) {
        await q.query(
          `INSERT INTO quiz_questions(key, quiz_set_id, position, level, text, answer) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (key) DO UPDATE SET level = EXCLUDED.level, text = EXCLUDED.text, answer = EXCLUDED.answer`,
          [qu.key, rows[0].id, qu.position, qu.level, qu.text, qu.answer],
        );
      }
    }
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __snsDb: Promise<Db> | undefined;
}

/** アプリ全体で共有するDB。初回に自動でmigrate + 初期マスター投入（冪等） */
export function getDb(): Promise<Db> {
  if (!globalThis.__snsDb) {
    globalThis.__snsDb = (async () => {
      const db = await createDb();
      if (process.env.AUTO_MIGRATE !== 'false') {
        await migrate(db);
        const [c] = await db.query<{ s: number; q: number; z: number }>("SELECT (SELECT count(*) FROM stores)::int AS s, (SELECT count(*) FROM questions)::int AS q, (SELECT count(*) FROM quiz_questions)::int AS z");
        if (c.s < 3 || c.q < 60 || c.z < 100) await seedMaster(db);
      }
      return db;
    })();
    globalThis.__snsDb.catch(() => {
      globalThis.__snsDb = undefined;
    });
  }
  return globalThis.__snsDb;
}
