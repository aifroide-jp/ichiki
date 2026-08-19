#!/usr/bin/env node
'use strict';

// ピクセル差分の「どこが違うか」を目で見るための切り出し。
//   node src/visual/crop.js <ラベル>            … 差分の塊を一覧
//   node src/visual/crop.js <ラベル> <y> [高さ] … その位置を before/after で切り出す
//
// compare.js が out/ に置いた <ラベル>-before.png / -after.png / -diff.png を読む。
// 切り出しは out/crop-<ラベル>-<y>-before.png / -after.png に出る。

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// 画像の置き場所は compare.js の出力先。環境変数か既定の ./visual-out。
const OUT = process.env.ICHIKI_VISUAL_OUT || path.join(process.cwd(), 'visual-out');
const [label, yArg, hArg] = process.argv.slice(2);

if (!label) {
  console.error('使い方: node src/visual/crop.js <ラベル> [y] [高さ]');
  console.error('  ラベル: compare.js の PAIRS の1列目（index / contact / events-sample …）');
  process.exit(2);
}

const read = (suffix) => PNG.sync.read(fs.readFileSync(path.join(OUT, `${label}-${suffix}.png`)));

if (!yArg) {
  // 差分ピクセルを行ごとに数え、連続する塊にまとめて出す
  const d = read('diff');
  const rows = new Array(d.height).fill(0);
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const i = (d.width * y + x) << 2;
      if (d.data[i] > 200 && d.data[i + 1] < 100) rows[y]++;
    }
  }
  const bands = [];
  let cur = null;
  for (let y = 0; y < d.height; y++) {
    if (rows[y]) {
      if (!cur) cur = { from: y, to: y, px: 0 };
      cur.to = y;
      cur.px += rows[y];
    } else if (cur && y - cur.to > 8) {
      bands.push(cur);
      cur = null;
    }
  }
  if (cur) bands.push(cur);
  console.log(`${label}: 全高 ${d.height}px / 差分の塊 ${bands.length}件`);
  for (const b of bands.sort((a, z) => z.px - a.px)) {
    console.log(`  y=${b.from}..${b.to}  ${b.px}px   → node src/visual/crop.js ${label} ${Math.max(0, b.from - 20)}`);
  }
  process.exit(0);
}

const y = parseInt(yArg, 10);
const h = parseInt(hArg || '120', 10);
for (const side of ['before', 'after']) {
  const src = read(side);
  const height = Math.min(h, src.height - y);
  const out = new PNG({ width: src.width, height });
  PNG.bitblt(src, out, 0, y, src.width, height, 0, 0);
  const dst = path.join(OUT, `crop-${label}-${y}-${side}.png`);
  fs.writeFileSync(dst, PNG.sync.write(out));
  console.log(`  ${dst}`);
}
