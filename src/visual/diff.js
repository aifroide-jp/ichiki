#!/usr/bin/env node
/**
 * visual-diff.js
 * モックアップ（ローカルサーブ）と WP ローカルをページごとに
 * スクリーンショット比較し、HTML レポートを生成する。
 *
 * 使い方:
 *   node diff.js                        # デスクトップ (1280px) 全ページ
 *   node diff.js --mobile               # モバイル (375px)
 *   node diff.js --both                 # 両方
 *   node diff.js --only=トップ,全体像    # ラベル部分一致・カンマ区切りで複数指定可
 */

const http        = require('http');
const path        = require('path');
const fs          = require('fs');
const { chromium } = require('playwright');
const serveHandler = require('serve-handler');
const { PNG }      = require('pngjs');
const pixelmatch   = require('pixelmatch');


// ── 設定 ────────────────────────────────────────────────────────────
// 案件ごとに違うものは全部引数で受ける。
//   node src/visual/diff.js <モックルート> <pages.json> <WPのURL> [出力先] [--mobile|--both|--only=…]
const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (cliArgs.length < 3) {
  console.error('使い方: node src/visual/diff.js <モックルート> <pages.json> <WPのURL> [出力先]');
  process.exit(2);
}
const MOCKUP_ROOT = path.resolve(cliArgs[0]);
const PAGES       = JSON.parse(fs.readFileSync(path.resolve(cliArgs[1]), 'utf8'));
const WP_BASE     = cliArgs[2].replace(/\/$/, '');
const MOCKUP_PORT = 18080;
const MOCKUP_BASE = `http://localhost:${MOCKUP_PORT}`;
const REPORT_DIR  = path.resolve(cliArgs[3] || path.join(process.cwd(), 'visual-diff-report'));
const THRESHOLD   = 0.1;   // pixelmatch 許容誤差 (0〜1)

const args    = process.argv.slice(2);
const MOBILE  = args.includes('--mobile');
const BOTH    = args.includes('--both');
const DESKTOP = !MOBILE || BOTH;
const ONLY    = (args.find(a => a.startsWith('--only=')) || '').slice('--only='.length);
const ONLY_LABELS  = ONLY ? ONLY.split(',').map(s => s.trim()).filter(Boolean) : [];
const TARGET_PAGES = ONLY_LABELS.length
  ? PAGES.filter(p => ONLY_LABELS.some(label => p.label.includes(label)))
  : PAGES;

const VIEWPORTS = [
  ...(DESKTOP ? [{ name: 'desktop', width: 1280, height: 900 }] : []),
  ...(MOBILE || BOTH ? [{ name: 'mobile', width: 375,  height: 812 }] : []),
];

// ── ローカルサーバー起動 ────────────────────────────────────────────
function startMockupServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) =>
      serveHandler(req, res, { public: MOCKUP_ROOT })
    );
    server.listen(MOCKUP_PORT, () => {
      console.log(`[mockup server] http://localhost:${MOCKUP_PORT}`);
      resolve(server);
    });
  });
}

// ── lazy 画像をすべてロードさせるスクロール ──────────────────────────
async function scrollToLoadLazy(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const distance = 400;
      const delay    = 80;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, delay);
    });
  });
  // スクロール後に残りのネットワークが落ち着くまで待つ
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

// ── 時間差で結果が揺れる要素を撮影前に固定する ───────────────────────
async function freezeForScreenshot(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-play-state: paused !important;
        transition: none !important;
      }
      .header { position: static !important; }
      .facilities-track { animation: none !important; transform: translateX(0) !important; }
      .hero-slide { transition: none !important; opacity: 0 !important; }
      .hero-slide:first-child { opacity: 1 !important; }
    `,
  }).catch(() => {});
}

// ── スクリーンショット取得 ──────────────────────────────────────────
async function screenshot(page, url, outPath) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await freezeForScreenshot(page);
    await scrollToLoadLazy(page);
    await page.screenshot({ path: outPath, fullPage: true });
    return true;
  } catch (e) {
    console.warn(`  [skip] ${url} — ${e.message}`);
    return false;
  }
}

// ── pixelmatch でピクセル差分 ───────────────────────────────────────
function diffImages(imgAPath, imgBPath, outPath) {
  if (!fs.existsSync(imgAPath) || !fs.existsSync(imgBPath)) return null;

  const imgA = PNG.sync.read(fs.readFileSync(imgAPath));
  const imgB = PNG.sync.read(fs.readFileSync(imgBPath));

  // 高さを揃える（短い方を伸ばす）
  const width  = Math.max(imgA.width,  imgB.width);
  const height = Math.max(imgA.height, imgB.height);

  const padded = (src) => {
    if (src.width === width && src.height === height) return src;
    const out = new PNG({ width, height });
    PNG.bitblt(src, out, 0, 0, src.width, src.height, 0, 0);
    return out;
  };

  const a = padded(imgA);
  const b = padded(imgB);
  const diff = new PNG({ width, height });

  const numDiff = pixelmatch(
    a.data, b.data, diff.data,
    width, height,
    { threshold: THRESHOLD, includeAA: false }
  );

  fs.writeFileSync(outPath, PNG.sync.write(diff));

  const total   = width * height;
  const pct     = ((numDiff / total) * 100).toFixed(2);
  return { numDiff, total, pct };
}

// ── img → base64 data URI ───────────────────────────────────────────
function toDataURI(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:image/png;base64,${data}`;
}

// ── HTML レポート生成 ──────────────────────────────────────────────
function buildReport(results) {
  const rows = results.map(r => {
    const badge = (pct) => {
      const n = parseFloat(pct);
      const color = n < 1 ? '#2e7d32' : n < 5 ? '#f57f17' : '#c62828';
      return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-weight:700;">${pct}%</span>`;
    };
    return r.viewports.map(v => `
      <tr>
        <td>${r.label}</td>
        <td>${v.name}</td>
        <td>${v.result ? badge(v.result.pct) : '<span style="color:#999">skip</span>'}</td>
        <td><a href="${v.mockupImg}" target="_blank"><img src="${v.mockupImg}" style="max-width:280px;border:1px solid #ddd;"></a></td>
        <td><a href="${v.wpImg}"     target="_blank"><img src="${v.wpImg}"     style="max-width:280px;border:1px solid #ddd;"></a></td>
        <td><a href="${v.diffImg}"   target="_blank"><img src="${v.diffImg}"   style="max-width:280px;border:1px solid #ddd;"></a></td>
      </tr>`).join('');
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>Visual Diff</title>
<style>
body { font-family: sans-serif; font-size: 14px; margin: 0; padding: 20px; background: #f5f5f5; }
h1 { color: #2c5f2d; }
table { border-collapse: collapse; width: 100%; background: #fff; }
th, td { border: 1px solid #ddd; padding: 8px 12px; vertical-align: top; }
th { background: #2c5f2d; color: #fff; white-space: nowrap; }
tr:hover td { background: #f9f9f9; }
</style>
</head>
<body>
<h1>Visual Diff</h1>
<p>threshold: ${THRESHOLD} / generated: ${new Date().toISOString()}</p>
<table>
<thead><tr><th>ページ</th><th>viewport</th><th>差分</th><th>モックアップ</th><th>WordPress</th><th>Diff</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;

  const outPath = path.join(REPORT_DIR, 'index.html');
  fs.writeFileSync(outPath, html);
  console.log(`\n✅ レポート: ${outPath}`);
}

// ── メイン ────────────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const server  = await startMockupServer();
  const browser = await chromium.launch();

  const results = [];

  for (const pageInfo of TARGET_PAGES) {
    console.log(`\n[${pageInfo.label}]`);
    const pageResult = { label: pageInfo.label, viewports: [] };

    for (const vp of VIEWPORTS) {
      const slug = pageInfo.label.replace(/[^\w　-鿿]/g, '_');
      const prefix = `${slug}_${vp.name}`;

      const mockupImg = path.join(REPORT_DIR, `${prefix}_mockup.png`);
      const wpImg     = path.join(REPORT_DIR, `${prefix}_wp.png`);
      const diffImg   = path.join(REPORT_DIR, `${prefix}_diff.png`);

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const pg = await context.newPage();

      const mockupUrl = `${MOCKUP_BASE}/${pageInfo.mockup}`;
      const wpUrl     = `${WP_BASE}${pageInfo.wp}`;

      console.log(`  ${vp.name}: ${mockupUrl}`);
      const okMockup = await screenshot(pg, mockupUrl, mockupImg);

      console.log(`  ${vp.name}: ${wpUrl}`);
      const okWp = await screenshot(pg, wpUrl, wpImg);

      let result = null;
      if (okMockup && okWp) {
        result = diffImages(mockupImg, wpImg, diffImg);
        console.log(`  diff: ${result.pct}% (${result.numDiff}px)`);
      }

      await context.close();

      pageResult.viewports.push({
        name: vp.name,
        result,
        mockupImg: path.relative(REPORT_DIR, mockupImg),
        wpImg:     path.relative(REPORT_DIR, wpImg),
        diffImg:   path.relative(REPORT_DIR, diffImg),
      });
    }

    results.push(pageResult);
  }

  await browser.close();
  server.close();

  buildReport(results);
})();
