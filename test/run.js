'use strict';
// Ichiki Phase 0 スナップショット回帰テスト
//   npm test            … fixture をスキャンし test/expected/acf-map.yaml と比較
//   npm run test:update … 期待値(expected)を現在の出力で更新する（仕様変更を意図的に確定するとき）
// generated_at 行は日付で毎回変わるため比較対象から除外する。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmp = path.join(__dirname, '.tmp-out');
const expPath = path.join(__dirname, 'expected', 'acf-map.yaml');

fs.mkdirSync(tmp, { recursive: true });
const r = spawnSync('node', [path.join(root, 'src', 'scan.js'), path.join(root, 'fixture'), tmp], {
  encoding: 'utf8',
});
if (r.status !== 0) {
  console.error('NG: scan が失敗しました\n' + (r.stdout || '') + (r.stderr || ''));
  process.exit(1);
}

const norm = s => s.split('\n').filter(l => !l.startsWith('generated_at:')).join('\n');
const got = norm(fs.readFileSync(path.join(tmp, 'acf-map.yaml'), 'utf8'));

if (process.argv.includes('--update')) {
  fs.mkdirSync(path.dirname(expPath), { recursive: true });
  fs.copyFileSync(path.join(tmp, 'acf-map.yaml'), expPath);
  console.log('OK: expected を現在の出力で更新しました ->', path.relative(root, expPath));
  process.exit(0);
}

if (!fs.existsSync(expPath)) {
  console.error('NG: test/expected/acf-map.yaml がありません。`npm run test:update` で作成してください');
  process.exit(1);
}

const exp = norm(fs.readFileSync(expPath, 'utf8'));
if (got === exp) {
  console.log('OK: acf-map.yaml はスナップショットと一致しました');
  process.exit(0);
}

console.error('NG: acf-map.yaml がスナップショットと不一致です（差分を表示します）');
const g = got.split('\n');
const e = exp.split('\n');
const max = Math.max(g.length, e.length);
let shown = 0;
for (let i = 0; i < max && shown < 30; i++) {
  if (g[i] !== e[i]) {
    console.error(`  line ${i + 1}:`);
    console.error(`    expected: ${e[i] === undefined ? '(行なし)' : e[i]}`);
    console.error(`    got     : ${g[i] === undefined ? '(行なし)' : g[i]}`);
    shown++;
  }
}
if (shown === 0) console.error('  （行数のみ差分。expected と got の末尾を確認してください）');
console.error('意図した変更なら `npm run test:update` で期待値を更新してください');
process.exit(1);
