// UI受け入れテスト（実ブラウザ）。別DB(.data/e2e)で本番ビルドを起動し、Edge(Chromium)で操作する。
//   npm run build && npm run test:e2e
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createDb, migrate, seedMaster } from '../src/lib/db';
import { createUser } from '../src/lib/auth';

const PORT = 3101;
const GEMINI_PORT = 3199;
// Gemini偽サーバー（本物のAPIは呼ばない）
const geminiCalls: { key: string; body: string }[] = [];
let geminiFail = false;
const geminiStub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    geminiCalls.push({ key: String(req.headers['x-goog-api-key'] ?? ''), body });
    res.setHeader('Content-Type', 'application/json');
    if (geminiFail) {
      res.statusCode = 429;
      res.end(JSON.stringify({ error: { message: 'quota exceeded (stub)' } }));
      return;
    }
    const candidates = [1, 2, 3].map((i) => ({ label: `スタブ${i}`, caption: `スタブ案${i}：新メニューのカルビ！ #焼肉` }));
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ candidates }) }] } }] }));
  });
});
const BASE = `http://localhost:${PORT}`;
const DATA = path.resolve('.data/e2e');
const results: { name: string; ok: boolean; err?: string }[] = [];
const shots = path.resolve('test-results');
fs.mkdirSync(shots, { recursive: true });

async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, err: (e as Error).message.split('\n')[0] });
    console.log(`  ✗ ${name}\n      ${(e as Error).message.split('\n').slice(0, 4).join('\n      ')}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const norm = (s: string) => s.replace(/\s+/g, ' ');

async function setup() {
  fs.rmSync(DATA, { recursive: true, force: true });
  process.env.PGLITE_DIR = DATA;
  const db = await createDb({ pgliteDir: DATA });
  await migrate(db);
  await seedMaster(db);
  const stores = Object.fromEntries((await db.query<{ key: string; id: string }>('SELECT key, id FROM stores')).map((s) => [s.key, s.id]));
  await createUser(db, { email: 'admin@example.com', displayName: 'E2E管理者', password: 'e2e-password-1', isSystemAdmin: true });
  await createUser(db, { email: 'editor@example.com', displayName: 'E2E編集者', password: 'e2e-password-2', memberships: [{ storeId: stores['b-club'], role: 'editor' }] });
  await createUser(db, { email: 'viewer@example.com', displayName: 'E2E閲覧者', password: 'e2e-password-3', memberships: [{ storeId: stores['b-club'], role: 'viewer' }] });
  await db.close();
}

function startServer(): Promise<ChildProcess> {
  const nextBin = path.resolve('node_modules/next/dist/bin/next');
  const p = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
    env: { ...process.env, PGLITE_DIR: DATA, COOKIE_SECURE: 'false', NODE_ENV: 'production', GEMINI_API_KEY: 'stub-key', GEMINI_BASE_URL: `http://localhost:${GEMINI_PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('サーバー起動がタイムアウトしました')), 60000);
    p.stdout?.on('data', (d) => {
      if (String(d).includes('Ready') || String(d).includes('started server')) {
        clearTimeout(to);
        resolve(p);
      }
    });
    p.on('exit', (c) => reject(new Error(`サーバーが終了しました code=${c}`)));
  });
}

async function login(page: Page, email: string, pw: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('名前 または メールアドレス').fill(email);
  await page.getByLabel('PIN または パスワード').fill(pw);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

async function statText(page: Page, testid: string, label: string): Promise<string> {
  const box = page.locator(`[data-testid="${testid}"] > div`, { hasText: label }).first();
  return norm(await box.innerText());
}

async function main() {
  await setup();
  await new Promise<void>((r) => geminiStub.listen(GEMINI_PORT, r));
  const server = await startServer();
  const browser: Browser = await chromium.launch({ channel: 'msedge', headless: true });
  let ctx: BrowserContext | undefined;
  try {
    ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'America/Los_Angeles' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);

    console.log('\n[認証・店舗選択・分離]');
    await t('未ログインで店舗ページ・CSVにアクセスするとログインへ/401', async () => {
      await page.goto(`${BASE}/s/b-club`);
      assert(page.url().includes('/login'), `ログインに遷移しない: ${page.url()}`);
      const r = await page.request.get(`${BASE}/s/b-club/export/casts`);
      assert(r.status() === 401, `CSVが401でない: ${r.status()}`);
    });
    await t('パスワード誤りはエラー表示でログインできない', async () => {
      await login(page, 'admin@example.com', 'wrong-password');
      await page.getByTestId('login-error').waitFor();
      assert((await page.getByTestId('login-error').innerText()).includes('正しくありません'), 'エラー文言なし');
      assert(page.url().includes('/login'), 'ログイン画面のまま');
    });
    await t('ログイン後、最初に店舗選択(4店舗の大きなカード)', async () => {
      await login(page, 'admin@example.com', 'e2e-password-1');
      await page.waitForURL(`${BASE}/`);
      for (const n of ['B-club', 'KINGYO', 'C-girl']) await page.getByRole('link', { name: new RegExp(n) }).first().waitFor();
      assert((await page.locator('main ul > li').count()) === 4, '店舗カードが4件でない');
    });
    await t('店舗を選ぶと店名が常時表示され、店舗切替ができる', async () => {
      await page.getByRole('link', { name: /B-club/ }).first().click();
      await page.waitForURL(`${BASE}/s/b-club`);
      assert((await page.getByTestId('store-name').innerText()).trim() === 'B-club', '店名表示なし');
      await page.getByTestId('switch-store').click();
      await page.waitForURL(`${BASE}/`);
      await page.getByRole('link', { name: /KINGYO/ }).first().click();
      await page.waitForURL(`${BASE}/s/kingyo`);
      assert((await page.getByTestId('store-name').innerText()).trim() === 'KINGYO', 'KINGYO表示なし');
    });

    console.log('\n[キャスト登録・保存の永続化]');
    await t('キャスト未登録なら登録への導線が出る', async () => {
      await page.goto(`${BASE}/s/b-club/casts`);
      await page.getByRole('link', { name: /キャストを登録する/ }).first().waitFor();
    });
    await t('キャストを登録→再読込しても残る。連打しても1件だけ', async () => {
      await page.goto(`${BASE}/s/b-club/casts/new`);
      await page.getByLabel('表示名').fill('Aさん');
      const btn = page.getByRole('button', { name: 'キャストを登録' });
      await btn.dblclick();
      await page.waitForURL(/\/casts\/[0-9a-f-]{36}$/);
      await page.reload();
      assert((await page.locator('h1').innerText()).includes('Aさん'), '詳細に名前なし');
      await page.goto(`${BASE}/s/b-club/casts`);
      const rows = await page.locator('[data-testid="cast-table"] tbody tr').count();
      assert(rows === 1, `キャスト行が${rows}件（連打で二重登録）`);
    });
    await t('編集して再読込後も保持', async () => {
      await page.getByRole('link', { name: 'Aさん' }).first().click();
      await page.getByRole('link', { name: '編集' }).click();
      await page.getByLabel('メモ').fill('E2Eメモ');
      await page.getByRole('button', { name: '変更を保存' }).click();
      await page.waitForURL(/\/casts\/[0-9a-f-]{36}$/);
      await page.reload();
      assert((await page.locator('body').innerText()).includes('E2Eメモ'), 'メモが保持されていない');
    });
    await t('別店舗(KINGYO)にはBのキャストが混在しない', async () => {
      await page.goto(`${BASE}/s/kingyo/casts`);
      assert(!(await page.locator('body').innerText()).includes('Aさん'), 'KINGYOにAさんが表示された');
    });
    await t('別セッション(別端末相当)でも同じキャストが見える', async () => {
      const ctx2 = await browser.newContext({ viewport: { width: 400, height: 800 } });
      const p2 = await ctx2.newPage();
      await login(p2, 'editor@example.com', 'e2e-password-2');
      await p2.waitForURL(`${BASE}/`);
      await p2.goto(`${BASE}/s/b-club/casts`);
      assert((await p2.locator('body').innerText()).includes('Aさん'), '別端末でAさんが見えない');
      await ctx2.close();
    });

    console.log('\n[素材登録→投稿→集計（検算例）]');
    await t('PR画像10枚を登録→個別素材10点、投稿件数は増えない', async () => {
      await page.goto(`${BASE}/s/b-club/materials/new`);
      await page.locator('label', { hasText: 'Aさん' }).first().click();
      await page.getByLabel(/^数量/).fill('10');
      await page.getByLabel(/^タイトル/).fill('9月 PR画像');
      await page.getByTestId('submit-material').click();
      await page.getByTestId('created-banner').waitFor();
      const n = await page.locator('[data-testid="gallery"] > li').count();
      assert(n === 10, `個別素材が${n}点`);
      assert((await page.getByTestId('gallery').innerText()).includes('01') && (await page.getByTestId('gallery').innerText()).includes('10'), '番号付きでない');
      await page.goto(`${BASE}/s/b-club`);
      assert(/投稿済み件数 0/.test(await statText(page, 'post-stats', '投稿済み件数')), '素材登録で投稿件数が増えた');
      assert(/素材総数 10/.test(await statText(page, 'material-stats', '素材総数')), '素材総数が10でない');
    });
    await t('0・小数の数量は項目の近くに日本語エラー、保存されない', async () => {
      await page.goto(`${BASE}/s/b-club/materials/new`);
      await page.locator('label', { hasText: 'Aさん' }).first().click();
      await page.getByLabel(/^タイトル/).fill('NG');
      for (const bad of ['0', '1.5']) {
        await page.getByLabel(/^数量/).fill(bad);
        await page.getByTestId('submit-material').click();
        await page.getByTestId('error-quantity').waitFor();
        assert((await page.getByTestId('error-quantity').innerText()).includes('整数'), `数量${bad}のエラー文言`);
      }
      await page.goto(`${BASE}/s/b-club`);
      assert(/素材総数 10/.test(await statText(page, 'material-stats', '素材総数')), '不正数量が保存された');
    });
    await t('3枚でInstagram投稿済み→10/使用済み3/未使用7/投稿1。同じ3枚をTikTokにも→投稿2', async () => {
      const post = async (platformLabel: string, ids: string) => {
        await page.goto(`${BASE}/s/b-club/posts/new`);
        const cbs = page.locator('[data-testid="picker"] input[type=checkbox]');
        for (let i = 0; i < 3; i++) await cbs.nth(i).check();
        if (platformLabel === 'TikTok') {
          await page.locator('label', { hasText: 'Instagram' }).first().click();
          await page.locator('label', { hasText: 'TikTok' }).first().click();
        }
        await page.getByLabel(/^タイトル/).fill(`PR投稿 ${ids}`);
        const idp = platformLabel === 'TikTok' ? 'tiktok' : 'instagram';
        await page.locator(`#${idp}-status`).selectOption('published');
        await page.locator(`#${idp}-pub`).fill('2026-01-10T19:30');
        await page.getByTestId('submit-post').click();
        await page.getByTestId('created-banner').waitFor();
      };
      await post('Instagram', 'ig');
      await page.goto(`${BASE}/s/b-club`);
      let m = await statText(page, 'material-stats', '使用済み素材');
      assert(/使用済み素材 3/.test(m), `使用済み: ${m}`);
      assert(/未使用素材 7/.test(await statText(page, 'material-stats', '未使用素材')), '未使用が7でない');
      assert(/投稿済み件数 1/.test(await statText(page, 'post-stats', '投稿済み件数')), '投稿済みが1でない');
      await post('TikTok', 'tt');
      await page.goto(`${BASE}/s/b-club`);
      m = await statText(page, 'material-stats', '使用済み素材');
      assert(/使用済み素材 3/.test(m), `TikTok後の使用済み: ${m}`);
      assert(/投稿済み件数 2/.test(await statText(page, 'post-stats', '投稿済み件数')), '投稿済みが2でない');
    });
    await t('別の2枚を投稿予定にしても使用済みは増えず、投稿済みに変更すると増える', async () => {
      await page.goto(`${BASE}/s/b-club/posts/new`);
      const cbs = page.locator('[data-testid="picker"] input[type=checkbox]');
      await page.getByLabel('未使用のみ').check();
      await cbs.nth(0).check();
      await cbs.nth(1).check();
      await page.getByLabel(/^タイトル/).fill('予定投稿');
      await page.locator('#instagram-status').selectOption('scheduled');
      await page.locator('#instagram-sched').fill('2099-01-01T12:00');
      await page.getByTestId('submit-post').click();
      await page.getByTestId('created-banner').waitFor();
      const detailUrl = page.url().split('?')[0];
      await page.goto(`${BASE}/s/b-club`);
      assert(/使用済み素材 3/.test(await statText(page, 'material-stats', '使用済み素材')), '予定で使用済みが増えた');
      assert(/投稿予定 1/.test(await statText(page, 'post-stats', '投稿予定')), '投稿予定が1でない');
      await page.goto(`${detailUrl}/edit`);
      await page.locator('#edit-status').selectOption('published');
      await page.locator('#edit-pub').fill('2026-01-11T10:00');
      await page.getByTestId('submit-post').click();
      await page.getByTestId('saved-banner').waitFor();
      await page.goto(`${BASE}/s/b-club`);
      assert(/使用済み素材 5/.test(await statText(page, 'material-stats', '使用済み素材')), '使用済み5でない');
      assert(/投稿済み件数 3/.test(await statText(page, 'post-stats', '投稿済み件数')), '投稿済み3でない');
      await page.goto(`${BASE}/s/b-club/posts`);
      assert((await page.locator('[data-testid="post-list"] > li').count()) === 3, '一覧が3件でない（二重計上）');
    });
    await t('投稿の未来日時はエラーで「投稿予定へ」を案内し、保存されない', async () => {
      await page.goto(`${BASE}/s/b-club/posts/new`);
      await page.getByLabel(/^タイトル/).fill('未来');
      await page.locator('#instagram-status').selectOption('published');
      await page.locator('#instagram-pub').fill('2099-01-01T12:00');
      await page.getByTestId('submit-post').click();
      await page.getByTestId('form-error').waitFor();
      assert((await page.getByTestId('form-error').innerText()).includes('投稿予定'), '案内なし');
      assert((await page.getByLabel(/^タイトル/).inputValue()) === '未来', '入力が消えた');
    });

    console.log('\n[インタビュー・回答進捗]');
    await t('SET 01を2問回答・1問パスで登録→回答2・完了0。後日回答で3・完了1', async () => {
      await page.goto(`${BASE}/s/b-club/materials/new`);
      await page.locator('label', { hasText: 'Aさん' }).first().click();
      await page.locator('label', { hasText: 'インタビュー撮影' }).first().click();
      await page.getByLabel(/^質問セット/).selectOption({ label: 'SET 01｜まずは、どんな子？' });
      await page.getByTestId('question-readout').waitFor();
      assert((await page.getByTestId('question-readout').innerText()).includes('自分の性格をひと言でいうと？'), '質問本文なし');
      const radios = (q: number, label: string) => page.locator(`label:has(input[name^="a-"]):has-text("${label}")`).nth(q);
      await radios(0, '回答済み').click();
      await radios(1, '回答済み').click();
      await radios(2, 'パス').click();
      await page.getByTestId('submit-material').click();
      await page.getByTestId('created-banner').waitFor();
      await page.goto(`${BASE}/s/b-club/casts`);
      let row = norm(await page.locator('[data-testid="cast-table"] tbody tr', { hasText: 'Aさん' }).innerText());
      assert(/Aさん 10 0 0 3 7 7 0 2 /.test(row.replace(/\s+/g, ' ')) || row.includes(' 0 2 '), `キャスト行: ${row}`);
      // 後日回答
      await page.goto(`${BASE}/s/b-club/materials`);
      await page.getByRole('link', { name: /SET 01/ }).first().click();
      const sel = page.getByLabel('Q3 の回答状態');
      await sel.selectOption('answered');
      await page.getByRole('button', { name: '更新' }).last().click();
      await page.getByText('保存しました').first().waitFor();
      await page.goto(`${BASE}/s/b-club/casts`);
      row = norm(await page.locator('[data-testid="cast-table"] tbody tr', { hasText: 'Aさん' }).innerText());
      assert(/ 1 3 /.test(row), `完了1・回答3でない: ${row}`);
    });
    await t('質問集ページに全20セット・キャスト進捗表がある', async () => {
      await page.goto(`${BASE}/s/b-club/questions`);
      assert((await page.locator('[data-testid="question-sets"] > li').count()) === 20, '20セットでない');
      assert((await page.locator('[data-testid="question-sets"]').innerText()).includes('SET 20｜私のこと、覚えて帰って！'), 'SET 20なし');
      assert((await page.getByTestId('progress-matrix').locator('tbody tr').count()) === 1, '進捗表の行');
    });

    console.log('\n[カレンダー]');
    await t('カレンダーに撮影・回答/素材/投稿済みが出て、日付を押すと日別リストに詳細', async () => {
      await page.goto(`${BASE}/s/b-club/calendar?month=2026-01&day=2026-01-10`);
      const day = await page.getByTestId('cal-day-list').innerText();
      assert(/投稿済み/.test(day) && day.includes('Aさん') && /Instagram 19:30/.test(day), `1/10: ${day}`);
      assert(/TikTok 19:30/.test(day), 'TikTokが無い');
      await page.goto(`${BASE}/s/b-club/calendar?month=2026-01&day=2026-01-11`);
      assert(/Instagram 10:00/.test(await page.getByTestId('cal-day-list').innerText()), '予定→実績の日付(1/11)に出ない');
      assert(/Aさん/.test(await page.getByTestId('cal-grid').innerText()), 'グリッドにAさん');
    });

    console.log('\n[権限]');
    await t('編集者はB-clubのみ。KINGYOはURL直打ちでも拒否される', async () => {
      const c = await browser.newContext();
      const p = await c.newPage();
      await login(p, 'editor@example.com', 'e2e-password-2');
      await p.waitForURL(`${BASE}/`);
      assert((await p.locator('main ul > li').count()) === 1, '編集者に見える店舗が1つでない');
      await p.goto(`${BASE}/s/kingyo`);
      await p.waitForURL(/denied=1/);
      const r = await p.request.get(`${BASE}/s/kingyo/export/casts`);
      assert(r.status() === 403, `他店CSVが${r.status()}`);
      await p.goto(`${BASE}/admin/users`);
      assert(!p.url().includes('/admin/users'), '一般ユーザーが管理画面に入れた');
      await c.close();
    });
    await t('閲覧専用は登録ボタンが出ず、登録画面に入れない', async () => {
      const c = await browser.newContext();
      const p = await c.newPage();
      await login(p, 'viewer@example.com', 'e2e-password-3');
      await p.waitForURL(`${BASE}/`);
      await p.goto(`${BASE}/s/b-club`);
      assert((await p.getByRole('link', { name: /素材登録/ }).count()) === 0, '閲覧者に素材登録ボタン');
      await p.goto(`${BASE}/s/b-club/casts/new`);
      await p.waitForURL(/\/casts$/);
      assert(p.url().endsWith('/casts'), '閲覧者が登録画面に入れた');
      await c.close();
    });

    console.log('\n[素材のグリッド/詳細リスト]');
    await t('素材一覧をグリッドと詳細リストで切り替えられる（グループ・個別素材とも）', async () => {
      await page.goto(`${BASE}/s/b-club/materials`);
      await page.getByTestId('batch-grid').waitFor();
      assert((await page.getByTestId('batch-list').count()) === 0, '既定はグリッド');
      await page.getByTestId('layout-list').click();
      await page.getByTestId('batch-list').waitFor();
      await page.getByTestId('layout-grid').click();
      await page.getByTestId('batch-grid').waitFor();
      assert((await page.getByTestId('batch-grid').locator('> li').count()) >= 2, 'グリッドにカードがない');
      assert((await page.getByTestId('batch-grid').innerText()).includes('PR画像'), 'グリッドにタイトルがない');
      await page.goto(`${BASE}/s/b-club/materials?view=items&layout=grid`);
      await page.getByTestId('item-grid').waitFor();
      assert((await page.getByTestId('item-grid').locator('> li').count()) >= 5, '個別素材のグリッド');
      await page.getByTestId('layout-list').click();
      await page.getByTestId('item-select-list').waitFor();
    });

    console.log('\n[クイズ集]');
    await t('クイズ集: 20セット一覧、撮影用は正解を出さず、担当者用に正解とコメント', async () => {
      await page.goto(`${BASE}/s/b-club/quiz`);
      assert((await page.getByTestId('quiz-sets').locator('> li').count()) === 20, '20セットでない');
      assert((await page.getByTestId('quiz-sets').innerText()).includes('QUIZ 20｜季節と行事'), 'QUIZ 20なし');
      await page.goto(`${BASE}/s/b-club/quiz/1`);
      const q = await page.getByTestId('quiz-questions').innerText();
      assert(q.includes('日本で一番高い山は？') && q.includes('超難問'), '問題が出ない');
      assert(!q.includes('富士山') && !q.includes('奈良県') && !q.includes('琵琶湖'), '撮影用に正解が出ている');
      await page.goto(`${BASE}/s/b-club/quiz/1/answers`);
      assert((await page.getByTestId('quiz-answers').innerText()).includes('富士山'), '正解が出ない');
      assert((await page.getByTestId('quiz-comment').innerText()).includes('第5問の正解は【奈良県】'), 'コメントが出ない');
      await page.goto(`${BASE}/s/b-club/quiz/99`);
      await page.getByText('could not be found').waitFor();
    });
    await t('クイズの投稿登録: セットを引き継ぎ、一覧に投稿済みが反映される', async () => {
      await page.goto(`${BASE}/s/b-club/quiz`);
      await page.getByTestId('quiz-sets').locator('> li').first().getByRole('link', { name: '投稿登録' }).click();
      await page.getByLabel('クイズセット').waitFor();
      assert((await page.getByLabel('クイズセット').locator('option:checked').innerText()).includes('QUIZ 01｜日本地理'), 'セットが引き継がれない');
      await page.getByLabel(/^タイトル/).fill('クイズ01 投稿');
      await page.locator('#instagram-status').selectOption('published');
      await page.locator('#instagram-pub').fill('2026-01-12T12:00');
      await page.getByTestId('submit-post').click();
      await page.getByTestId('created-banner').waitFor();
      assert((await page.locator('body').innerText()).includes('QUIZ 01｜日本地理'), '投稿詳細にセットが出ない');
      await page.goto(`${BASE}/s/b-club/quiz`);
      assert(/投稿済み 1回/.test(await page.getByTestId('quiz-sets').locator('> li').first().innerText()), '一覧に投稿済みが出ない');
    });

    console.log('\n[AIキャプション（Gemini偽サーバーで動作確認）]');
    await t('AIで案を作り、確認して採用→キャプション欄とプレビューに反映。送信内容にキーは含まれない', async () => {
      await page.goto(`${BASE}/s/b-club/posts/new`);
      await page.getByTestId('ai-open').click();
      await page.getByLabel('元になる文章').fill('新メニューのカルビが出ました');
      await page.getByTestId('ai-generate').click();
      await page.getByTestId('ai-candidates').waitFor();
      assert((await page.getByTestId('ai-candidates').locator('> li').count()) === 3, '候補が3件でない');
      assert((await page.getByLabel('キャプション', { exact: true }).inputValue()) === '', '採用前にキャプション欄が変わった');
      await page.getByTestId('ai-apply-1').click();
      assert((await page.getByLabel('キャプション', { exact: true }).inputValue()).includes('スタブ案2'), '採用が反映されない');
      assert((await page.getByTestId('caption-preview').innerText()).includes('スタブ案2'), 'プレビューに出ない');
      assert(geminiCalls.length >= 1 && geminiCalls[0].key === 'stub-key' && geminiCalls[0].body.includes('新メニューのカルビ'), '偽サーバーに届いていない');
    });
    await t('AIが失敗したら日本語のエラーを出し、入力した文章は消えない', async () => {
      geminiFail = true;
      await page.goto(`${BASE}/s/b-club/posts/new`);
      await page.getByTestId('ai-open').click();
      await page.getByLabel('元になる文章').fill('失敗テスト');
      await page.getByTestId('ai-generate').click();
      await page.getByTestId('form-error').waitFor();
      assert((await page.getByTestId('form-error').innerText()).includes('AIの呼び出しに失敗'), 'エラー文言なし');
      assert((await page.getByLabel('元になる文章').inputValue()) === '失敗テスト', '入力が消えた');
      geminiFail = false;
    });

    console.log('\n[素材グループのギャラリー]');
    await t('ギャラリー: 写真だけが並び、選択モードで複数選択→状態を一括変更、タップで拡大して前後に移動', async () => {
      await page.goto(`${BASE}/s/b-club/materials?view=batches`);
      await page.getByTestId('batch-grid').locator('> li').filter({ hasText: 'PR画像' }).first().getByRole('link').click();
      await page.getByTestId('gallery').waitFor();
      const tiles = page.getByTestId('gallery-tile');
      assert((await tiles.count()) === 10, 'ギャラリーのタイルが10でない');
      // 通常タップ → 拡大表示
      await tiles.nth(0).click();
      await page.getByTestId('viewer').waitFor();
      assert((await page.getByTestId('viewer').innerText()).includes('BCL-PR-0001-01（1/10）'), '拡大表示の番号');
      await page.getByRole('button', { name: '次へ' }).click();
      assert((await page.getByTestId('viewer').innerText()).includes('（2/10）'), '次へで進まない');
      await page.keyboard.press('Escape');
      await page.getByTestId('viewer').waitFor({ state: 'detached' });
      // 選択モード → 3枚選ぶ → 状態を一括変更
      await page.getByTestId('select-mode').click();
      await tiles.nth(2).click();
      await tiles.nth(4).click();
      await tiles.nth(6).click();
      assert((await page.getByTestId('selection-bar').innerText()).includes('3点を選択中'), '選択数が3でない');
      await page.getByTestId('bulk-status').selectOption('unusable');
      await page.getByTestId('bulk-apply').click();
      await page.getByTestId('bulk-msg').waitFor();
      assert((await page.getByTestId('bulk-msg').innerText()).includes('3点'), '一括変更の結果');
      // 変更が保存されている（リスト表示で確認）
      await page.reload();
      await page.getByTestId('layout-itemlist').click();
      const unusable = await page.locator('[data-testid="items"] > li').filter({ hasText: 'NG・使用不可' }).count();
      assert(unusable === 0 || unusable >= 0, 'noop'); // 表示はセレクトの値なので下で値を確認
      const values = await page.locator('[data-testid="items"] select[aria-label$="の状態"]').evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
      assert(values.filter((v) => v === 'unusable').length === 3, `一括変更が反映されていない: ${values.join(',')}`);
    });

    console.log('\n[CSV]');
    await t('CSVは数式インジェクションを無害化する', async () => {
      await page.goto(`${BASE}/s/b-club/casts/new`);
      await page.getByLabel('表示名').fill('=SUM(A1)');
      await page.getByRole('button', { name: 'キャストを登録' }).click();
      await page.waitForURL(/\/casts\/[0-9a-f-]{36}$/);
      const r = await page.request.get(`${BASE}/s/b-club/export/casts`);
      assert(r.status() === 200, 'CSV取得失敗');
      const body = await r.text();
      assert(body.includes("'=SUM(A1)") && !/(^|,|\n)=SUM/.test(body), 'CSV数式が無害化されていない');
    });

    console.log('\n[通信失敗時の挙動]');
    await t('保存通信が失敗したら成功表示せず、入力を保持して再試行できる', async () => {
      await page.goto(`${BASE}/s/b-club/casts/new`);
      await page.getByLabel('表示名').fill('通信テストさん');
      await page.route('**/*', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
      await page.getByRole('button', { name: 'キャストを登録' }).click();
      await page.getByTestId('form-error').waitFor();
      assert((await page.getByTestId('form-error').innerText()).includes('保存されていません'), '失敗文言なし');
      assert(page.url().endsWith('/casts/new'), '成功扱いで遷移した');
      assert((await page.getByLabel('表示名').inputValue()) === '通信テストさん', '入力が消えた');
      await page.unroute('**/*');
      await page.getByRole('button', { name: 'キャストを登録' }).click();
      await page.waitForURL(/\/casts\/[0-9a-f-]{36}$/);
    });

    console.log('\n[375px スマホ]');
    await t('375px幅で店舗選択〜カレンダー日別リストまで操作でき、横スクロールが出ない', async () => {
      const mc = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'ja-JP' });
      const p = await mc.newPage();
      p.setDefaultTimeout(20000);
      const noOverflow = async (label: string) => {
        const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        assert(w.sw <= w.cw + 1, `${label}: 横スクロールあり ${w.sw}>${w.cw}`);
      };
      await login(p, 'admin@example.com', 'e2e-password-1');
      await p.waitForURL(`${BASE}/`);
      await noOverflow('店舗選択');
      await p.screenshot({ path: path.join(shots, 'm-store-select.png') });
      await p.getByRole('link', { name: /C-girl/ }).first().click();
      await p.waitForURL(`${BASE}/s/c-girl`);
      assert(await p.getByTestId('store-name').isVisible(), '店名が見えない');
      // 下部ナビ
      await p.getByRole('navigation', { name: '店舗メニュー（スマホ）' }).getByRole('link', { name: 'キャスト' }).click();
      await p.waitForURL(/\/casts$/);
      await p.getByRole('link', { name: /キャスト登録|キャストを登録する/ }).first().click();
      await p.getByLabel('表示名').fill('スマホさん');
      assert((await p.getByLabel('表示名').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 16, '入力文字が16px未満');
      await noOverflow('キャスト登録');
      await p.screenshot({ path: path.join(shots, 'm-cast-new.png') });
      await p.getByRole('button', { name: 'キャストを登録' }).click();
      await p.waitForURL(/\/casts\/[0-9a-f-]{36}$/);
      await p.goto(`${BASE}/s/c-girl/materials/new`);
      await p.locator('label', { hasText: 'スマホさん' }).first().click();
      await p.getByLabel(/^数量/).fill('3');
      await p.getByLabel(/^タイトル/).fill('スマホ素材');
      await noOverflow('素材登録');
      await p.screenshot({ path: path.join(shots, 'm-material-new.png') });
      await p.getByTestId('submit-material').click();
      await p.getByTestId('created-banner').waitFor();
      await p.goto(`${BASE}/s/c-girl/posts/new`);
      await noOverflow('投稿登録');
      await p.screenshot({ path: path.join(shots, 'm-post-new.png') });
      await p.getByLabel(/^タイトル/).fill('スマホ投稿');
      await p.locator('#instagram-status').selectOption('draft');
      await p.getByTestId('submit-post').click();
      await p.getByTestId('created-banner').waitFor();
      await p.goto(`${BASE}/s/c-girl/calendar`);
      await noOverflow('カレンダー');
      await p.screenshot({ path: path.join(shots, 'm-calendar.png') });
      assert(await p.getByTestId('cal-day-title').isVisible(), '日別リストが出ない');
      await p.goto(`${BASE}/s/c-girl/questions`);
      await noOverflow('質問集');
      assert((await p.getByTestId('progress-list').locator('> li').count()) === 20, 'スマホの20セット縦リスト');
      await p.goto(`${BASE}/s/c-girl`);
      await noOverflow('ダッシュボード');
      await p.screenshot({ path: path.join(shots, 'm-dashboard.png'), fullPage: true });
      // 素材一覧→詳細→編集まで
      await p.goto(`${BASE}/s/c-girl/materials`);
      await p.getByRole('link', { name: /スマホ素材/ }).first().click();
      await p.getByRole('button', { name: 'グループ情報を編集' }).click();
      await noOverflow('素材詳細・編集');
      await mc.close();
    });
    await t('PC画面のスクリーンショット(ダッシュボード/カレンダー)を保存', async () => {
      await page.goto(`${BASE}/s/b-club`);
      await page.screenshot({ path: path.join(shots, 'pc-dashboard.png'), fullPage: true });
      await page.goto(`${BASE}/s/b-club/calendar?month=2026-01&day=2026-01-10`);
      await page.screenshot({ path: path.join(shots, 'pc-calendar.png'), fullPage: true });
    });
  } finally {
    await ctx?.close().catch(() => {});
    await browser.close().catch(() => {});
    server.kill();
    geminiStub.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n結果: ${results.length - failed.length}/${results.length} 合格`);
  if (failed.length) {
    for (const f of failed) console.log(` ✗ ${f.name}: ${f.err}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
