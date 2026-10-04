// クイズPDFから取り出したテキスト(out.txt)を seed/QUIZ_SEED.json に変換する（一度きりの取り込み用）
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/\r/g, '');
const lines = src.split('\n').map((l) => l.trimEnd());
const join = (arr) => arr.join('').trim();

// 目次のタイトル
const titles = {};
for (const l of lines) {
  const m = l.match(/^(\d\d)(\D.+)$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 20 && !l.includes('/')) titles[Number(m[1])] = m[2];
}

const FOOTER = /^\d\d \/ 42/;
const sets = {};
let i = 0;
while (i < lines.length) {
  const mq = lines[i].match(/^QUIZ-(\d\d)\s*\/\s*撮影用・問題/);
  const ma = lines[i].match(/^QUIZ-(\d\d)\s*\/\s*スタッフ用・正解/);
  if (mq || ma) {
    const n = Number((mq || ma)[1]);
    const start = i + 1;
    let end = start;
    while (end < lines.length && !FOOTER.test(lines[end])) end++;
    const page = lines.slice(start, end);
    sets[n] ??= { set_number: n };
    if (mq) {
      const s = sets[n];
      s.title = page[0].trim();
      s.questions = [];
      let cur = null;
      for (let k = 1; k < page.length; k++) {
        const l = page[k];
        const q = l.match(/^Q0(\d)\s+(.+)$/);
        if (q) {
          cur = { position: Number(q[1]), level: q[2].split('｜')[0].trim(), text: [] };
          s.questions.push(cur);
          continue;
        }
        if (/^最後の答えはコメント欄|^タップして答え合わせ/.test(l)) { cur = null; continue; }
        if (/^1〜3問/.test(l)) continue;
        if (cur && l) cur.text.push(l);
      }
      s.questions.forEach((x) => (x.text = join(x.text)));
    } else {
      const s = sets[n];
      s.answers = {};
      let mode = 'answers';
      let cur = null;
      const comment = [];
      const memo = [];
      const ref = [];
      for (let k = 1; k < page.length; k++) {
        const l = page[k];
        if (/^第5問の正解・解説は/.test(l)) continue;
        if (l.startsWith('投稿者コメント')) { mode = 'comment'; continue; }
        if (l.startsWith('出題・判定メモ')) { mode = 'memo'; continue; }
        if (l.startsWith('第5問の参考')) { mode = 'ref'; continue; }
        if (mode === 'answers') {
          const a = l.match(/^Q(\d)$/);
          if (a) { cur = Number(a[1]); s.answers[cur] = []; continue; }
          if (cur && l) s.answers[cur].push(l);
        } else if (mode === 'comment') comment.push(l);
        else if (mode === 'memo') memo.push(l);
        else ref.push(l);
      }
      for (const key of Object.keys(s.answers)) s.answers[key] = join(s.answers[key]);
      {
        // PDFの折り返し改行を除き、「見出し／本文／結びの一言」の3つに整える
        const c = comment.filter(Boolean);
        const head = c.find((x) => x.startsWith('第5問の正解は')) ?? '';
        const tail = c.filter((x) => x.startsWith('みんなは'));
        const body = join(c.filter((x) => x !== head && !x.startsWith('みんなは')));
        s.comment = [head, body, ...tail].filter(Boolean).join('\n');
      }
      s.memo = join(memo);
      s.reference = join(ref);
    }
    i = end;
    continue;
  }
  i++;
}

const out = Object.values(sets).sort((a, b) => a.set_number - b.set_number).map((s) => ({
  key: `quiz-v1-set-${String(s.set_number).padStart(2, '0')}`,
  set_number: s.set_number,
  version: 1,
  title: s.title || titles[s.set_number],
  questions: (s.questions || []).map((q) => ({
    key: `quiz-v1-set-${String(s.set_number).padStart(2, '0')}-q${q.position}`,
    position: q.position,
    level: q.level,
    text: q.text,
    answer: s.answers?.[q.position] ?? '',
  })),
  comment_template: s.comment ?? '',
  memo: s.memo ?? '',
  reference: s.reference ?? '',
}));
fs.writeFileSync(process.argv[3], JSON.stringify({ schema_version: 1, quiz_sets: out }, null, 2));
console.log('sets', out.length, 'questions', out.reduce((a, s) => a + s.questions.length, 0));
for (const s of out) {
  const bad = s.questions.length !== 5 || s.questions.some((q) => !q.text || !q.answer);
  if (bad || !s.title || !s.comment_template) console.log('CHECK', s.set_number, s.title, s.questions.length);
}
