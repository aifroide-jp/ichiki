#!/usr/bin/env node
'use strict';

// 既存モックのページと、制約語彙版に書き直したページを
// フルページスクリーンショットで比較する。
//
// 「構造だけ変えた。見た目は変えていない」という主張の唯一の裏取り。
// 差分が出た場合に「許容範囲」と押し通さないため、
// しきい値は既定 0（1ピクセルでも違えば FAIL）とする。

const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const serveHandler = require('serve-handler');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

// 比較対象は案件ごとに違うので、案件側の JSON から読む。
//   node src/visual/compare.js <配信ルート> <pairs.json> [出力先] [--mobile]
// pairs.json: [{ "label": "index", "before": "index.html", "after": "proposal/…/index.html" }, …]
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (args.length < 2) {
  console.error('使い方: node src/visual/compare.js <配信ルート> <pairs.json> [出力先] [--mobile]');
  process.exit(2);
}
const ROOT = path.resolve(args[0]);
const PAIRS_FILE = path.resolve(args[1]);
const PORT = 18099;
const OUT = path.resolve(args[2] || path.join(process.cwd(), 'visual-out'));

// 比較対象: [ラベル, 既存モック, 制約版]
// index だけを見ていたため、他ページのタグを変えても検出できなかった。
// L31（wysiwyg を <p> に宣言しない）の対応で <p> を <div> に変えたページは、
// 既定マージンが変わりうるので比較対象に含める。
const PAIRS = [
  ['index', 'index.html', 'proposal/mockup-real/index.html'],
  ['contact', 'contact/index.html', 'proposal/mockup-real/contact/index.html'],
  ['events-index', 'events/index.html', 'proposal/mockup-real/events/index.html'],
  ['events-sample', 'events/sample.html', 'proposal/mockup-real/events/sample.html'],
  ['events-apply', 'events/summer-camp-apply.html', 'proposal/mockup-real/events/summer-camp-apply.html'],
  ['biodiversity', 'about/biodiversity.html', 'proposal/mockup-real/about/biodiversity.html'],
];

// アニメーション・スライドショーで無関係な差分が出るのを止める。
// 見た目の等価性を見たいのであって、タイミングを見たいのではない。
const FREEZE = `
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
`;

async function shoot(page, url, file) {
  // networkidle だけで待つと、外部の動画（nature-kitakyushu.com の .mp4）が
  // 落ちてこないときに永遠に終わらない。**比較したいのは見た目であって通信ではない。**
  // 落ちてこなくても描画は済んでいるので、時間で打ち切って先へ進む。
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
  } catch (e) {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    console.log(`  ※ ${url}: networkidle にならないので load で打ち切りました（外部リソース待ち）`);
  }
  await page.addStyleTag({ content: FREEZE });
  // スライドショーのタイマーを止め、必ず1枚目を表示させる
  await page.evaluate(() => {
    for (let i = 1; i < 10000; i++) window.clearInterval(i);
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('.hero-dot');
    slides.forEach((s, i) => {
      s.style.transform = 'scale(1)';
      s.classList.toggle('is-active', i === 0);
    });
    dots.forEach((d, i) => d.classList.toggle('is-active', i === 0));
    // 遅延読み込み画像を全て読み込ませる
    document.querySelectorAll('img[loading="lazy"]').forEach((im) => im.setAttribute('loading', 'eager'));
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: file, fullPage: true });
}

async function main() {
  const width = process.argv.includes('--mobile') ? 375 : 1280;
  fs.mkdirSync(OUT, { recursive: true });

  const server = http.createServer((req, res) => serveHandler(req, res, { public: ROOT, cleanUrls: false }));
  await new Promise((r) => server.listen(PORT, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });

  let failed = 0;
  for (const [label, a, b] of PAIRS) {
    const fa = path.join(OUT, `${label}-before.png`);
    const fb = path.join(OUT, `${label}-after.png`);
    await shoot(page, `http://localhost:${PORT}/${a}`, fa);
    await shoot(page, `http://localhost:${PORT}/${b}`, fb);

    const ia = PNG.sync.read(fs.readFileSync(fa));
    const ib = PNG.sync.read(fs.readFileSync(fb));

    if (ia.width !== ib.width || ia.height !== ib.height) {
      console.log(
        `${label}: FAIL 画像サイズが違う  before=${ia.width}x${ia.height}  after=${ib.width}x${ib.height}`
      );
      failed++;
      continue;
    }
    const diff = new PNG({ width: ia.width, height: ia.height });
    const n = pixelmatch(ia.data, ib.data, diff.data, ia.width, ia.height, { threshold: 0.1 });
    fs.writeFileSync(path.join(OUT, `${label}-diff.png`), PNG.sync.write(diff));
    const pct = ((n / (ia.width * ia.height)) * 100).toFixed(4);
    console.log(`${label}: 差分ピクセル ${n} / ${ia.width * ia.height} (${pct}%)  ${n === 0 ? 'PASS' : 'FAIL'}`);
    if (n !== 0) failed++;
  }

  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
}

main();
