/** 署名付きURLに「ダウンロード扱い（保存ダイアログ）」の指定とファイル名を付ける（Supabase Storageの download パラメータ） */
export function withDownload(url: string, fileName: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(fileName)}`;
}

/** 複数ファイルを順に保存する（ブラウザの複数ダウンロード制限を避けるため少し間隔をあける） */
export async function downloadAll(files: { url: string; name: string }[], gapMs = 500): Promise<void> {
  for (const f of files) {
    const a = document.createElement('a');
    a.href = withDownload(f.url, f.name);
    a.download = f.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, gapMs));
  }
}
