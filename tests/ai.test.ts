import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAiRate, generateCaptions } from '../src/lib/ai';
import { AppError } from '../src/lib/errors';

const ok = (obj: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] }), { status: 200 });

beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; });
afterEach(() => { delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_MODEL; });

describe('AIキャプション（Gemini）', () => {
  it('プロンプトに店舗・文体・元の文章を含めて送り、候補を返す。キーはヘッダーで渡しURLに含めない', async () => {
    const f = vi.fn().mockResolvedValue(ok({ candidates: [{ label: '元気め', caption: '今日もがんばります！ #焼肉' }, { label: '上品', caption: 'ご来店をお待ちしております。' }] }));
    const r = await generateCaptions({ platform: 'instagram', draft: '新メニューのカルビ', tone: 'energetic', castNames: ['アスカ'], title: '新作' }, '焼肉En', f as unknown as typeof fetch);
    expect(r).toEqual([{ label: '元気め', caption: '今日もがんばります！ #焼肉' }, { label: '上品', caption: 'ご来店をお待ちしております。' }]);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain('gemini-3.8-flash:generateContent');
    expect(String(url)).not.toContain('test-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    const prompt = body.contents[0].parts[0].text as string;
    expect(prompt).toContain('焼肉En');
    expect(prompt).toContain('新メニューのカルビ');
    expect(prompt).toContain('元気で明るい');
    expect(prompt).toContain('アスカ');
    expect(body.systemInstruction.parts[0].text).toContain('作らない');
  });

  it('コードブロック付きの回答も読める。モデルは環境変数で変えられる', async () => {
    process.env.GEMINI_MODEL = 'gemini-test';
    const f = vi.fn().mockResolvedValue(ok('```json\n{"candidates":[{"label":"","caption":"こんにちは"}]}\n```'));
    const r = await generateCaptions({ draft: 'x' }, 'B-club', f as unknown as typeof fetch);
    expect(r).toEqual([{ label: '案1', caption: 'こんにちは' }]);
    expect(String(f.mock.calls[0][0])).toContain('gemini-test:generateContent');
  });

  it('未設定・入力不正・API失敗・読み取り失敗は日本語のエラー', async () => {
    const f = vi.fn();
    delete process.env.GEMINI_API_KEY;
    await expect(generateCaptions({ draft: 'x' }, 's', f as unknown as typeof fetch)).rejects.toThrow('未設定');
    process.env.GEMINI_API_KEY = 'k';
    await expect(generateCaptions({ draft: '   ' }, 's', f as unknown as typeof fetch)).rejects.toBeInstanceOf(AppError);
    await expect(generateCaptions({ draft: 'a'.repeat(2001) }, 's', f as unknown as typeof fetch)).rejects.toBeInstanceOf(AppError);
    f.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }));
    await expect(generateCaptions({ draft: 'x' }, 's', f as unknown as typeof fetch)).rejects.toThrow('400');
    f.mockResolvedValueOnce(ok('これはJSONではありません'));
    await expect(generateCaptions({ draft: 'x' }, 's', f as unknown as typeof fetch)).rejects.toThrow('読み取れません');
    f.mockRejectedValueOnce(new Error('network'));
    await expect(generateCaptions({ draft: 'x' }, 's', f as unknown as typeof fetch)).rejects.toThrow('接続できません');
    f.mockResolvedValueOnce(new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }));
    await expect(generateCaptions({ draft: 'x' }, 's', f as unknown as typeof fetch)).rejects.toThrow('安全');
  });

  it('1分に10回までに制限する', () => {
    const t = Date.now();
    for (let i = 0; i < 10; i++) checkAiRate('u1', t + i);
    expect(() => checkAiRate('u1', t + 100)).toThrow('多すぎ');
    expect(() => checkAiRate('u2', t + 100)).not.toThrow();
    expect(() => checkAiRate('u1', t + 61_000)).not.toThrow();
  });
});

describe('DATABASE_URL の正規化', () => {
  it('Supabaseのpooler(:5432)はTransaction mode(:6543)に切り替える。他はそのまま', async () => {
    const { normalizeDatabaseUrl } = await import('../src/lib/db');
    expect(normalizeDatabaseUrl('postgresql://postgres.abc:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres')).toBe('postgresql://postgres.abc:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres');
    expect(normalizeDatabaseUrl('postgresql://postgres.abc:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres')).toContain(':6543/');
    expect(normalizeDatabaseUrl('postgresql://u:p@db.abc.supabase.co:5432/postgres')).toContain(':5432/');
    expect(normalizeDatabaseUrl('postgresql://u:p@localhost:5432/x')).toBe('postgresql://u:p@localhost:5432/x');
  });
});
