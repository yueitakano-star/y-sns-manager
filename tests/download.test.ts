import { describe, expect, it } from 'vitest';
import { withDownload } from '../src/lib/download';

describe('ダウンロードURL', () => {
  it('署名付きURLにdownloadパラメータ(ファイル名)を付ける。日本語・記号も安全にエンコード', () => {
    expect(withDownload('https://x.test/object/sign/materials/a.jpg?token=abc', 'a b.jpg')).toBe('https://x.test/object/sign/materials/a.jpg?token=abc&download=a%20b.jpg');
    expect(withDownload('https://x.test/a.mp4', '撮影#1.mp4')).toBe('https://x.test/a.mp4?download=%E6%92%AE%E5%BD%B1%231.mp4');
  });
});
