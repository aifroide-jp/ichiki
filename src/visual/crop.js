#!/usr/bin/env node
'use strict';

// ピクセル差分の「どこが違うか」を目で見るための切り出し。
//   node src/visual/crop.js <接頭辞>            … 差分の塊を一覧
//   node src/visual/crop.js <接頭辞> <y> [高さ] … その位置を mockup / target で切り出す
//
// diff.js が出力先に置いた <接頭辞>_mockup.png / _target.png / _diff.png を読む。
// 接頭辞は「ラベルの記号を _ に置換 + _desktop（または _mobile）」。
//   例: about/spots → about_spots_desktop
// 切り出しは crop-<接頭辞>-<y>-mockup.png / -wp.png に出る。

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// 画像の置き場所は diff.js の出力先。環境変数か既定の ./visual-diff-report。
const OUT = process.env.ICHIKI_VISUAL_OUT || path.join(process.cwd(), 'visual-diff-report');
const [label, yArg, hArg] = process.argv.slice(2);

if (!label) {
  console.error('使い方: node src/visual/crop.js <接頭辞> [y] [高さ]');
  console.error('  接頭辞: diff.js が出した画像のファイル名から _mockup.png を除いた部分');
  console.error('          （例: index_desktop / about_spots_desktop）');
  console.error(`  画像の置き場所: ${OUT}（ICHIKI_VISUAL_OUT で変更可）`);
  process.exit(2);
}

const read = (suffix) => PNG.sync.read(fs.readFileSync(path.join(OUT, `${label}_${suffix}.png`)));

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
for (const side of ['mockup', 'target']) {
  const src = read(side);
  const height = Math.min(h, src.height - y);
  const out = new PNG({ width: src.width, height });
  PNG.bitblt(src, out, 0, y, src.width, height, 0, 0);
  const dst = path.join(OUT, `crop-${label}-${y}-${side}.png`);
  fs.writeFileSync(dst, PNG.sync.write(out));
  console.log(`  ${dst}`);
}
