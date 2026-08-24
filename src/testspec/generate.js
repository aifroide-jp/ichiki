'use strict';
const fs = require('fs');
const path = require('path');

const { buildThemeModel, testCasePages } = require('./lib/theme-model');
const { checkLinks } = require('./lib/checks/links');
const { checkAcfRender } = require('./lib/checks/acf-render');
const { checkCf7 } = require('./lib/checks/cf7');
const { readA11yReport } = require('./lib/checks/a11y');
const { readVisualDiffReport } = require('./lib/checks/visual-diff');
const { renderC1Markdown } = require('./lib/render-c1');
const { renderC3Tsv, renderC3Guide } = require('./lib/render-c3');

// 案件のルート（.ichiki.json / acf-map.yaml がある場所）を引数で受け取る。
//   node src/testspec/generate.js <案件ルート>
// 出力先・形式は .ichiki.json の testspec 節で上書きできる。書かなければ既定。
const REPO_ROOT = path.resolve(process.argv[2] || process.cwd());
const ICHIKI_JSON = path.join(REPO_ROOT, '.ichiki.json');
if (!fs.existsSync(ICHIKI_JSON)) {
  console.error(`.ichiki.json がありません: ${ICHIKI_JSON}`);
  process.exit(2);
}
const ICHIKI = JSON.parse(fs.readFileSync(ICHIKI_JSON, 'utf8'));
const TS = ICHIKI.testspec || {};
const ACF_MAP_PATH = path.join(REPO_ROOT, 'acf-map.yaml');
const THEME_DIR = ICHIKI.theme_dir;
const SITE_URL = ICHIKI.site_url;
const OUT_DIR = path.resolve(REPO_ROOT, TS.out_dir || 'docs/検収');
const A11Y_REPORT_PATH = path.resolve(REPO_ROOT, TS.a11y_report || 'pa11y-report.json');

function findA11yEntry(a11yMap, page) {
  if (!a11yMap) return null;
  if (a11yMap.has(page.liveUrl)) return a11yMap.get(page.liveUrl);
  for (const [url, v] of a11yMap) {
    if (url.endsWith(page.urlPath)) return v;
  }
  return null;
}

async function main() {
  const model = buildThemeModel({ acfMapPath: ACF_MAP_PATH, themeDir: THEME_DIR, siteUrl: SITE_URL });
  const cases = testCasePages(model.pages);

  const a11yMap = readA11yReport(A11Y_REPORT_PATH);
  // 見た目の比較結果。場所は .ichiki.json の testspec 節で指定する。
  // 書かなければ「未実行」として縮退する（自動 OK 扱いにはしない）。
  // 対応表は diff が出力側に置く（<出力先>/pages.json）。案件側に手書きさせない。
  const visualDiff = readVisualDiffReport(
    TS.visual_report ? path.resolve(REPO_ROOT, TS.visual_report, 'pages.json') : null,
    TS.visual_report ? path.resolve(REPO_ROOT, TS.visual_report, 'results.json') : null
  );

  console.log(`acf-map.yaml 全ページ数: ${model.pages.length} / テストケース数: ${cases.length}`);
  console.log(`site_url: ${SITE_URL}`);
  console.log('');

  const checkResultsByPageId = {};

  for (let i = 0; i < cases.length; i++) {
    const page = cases[i];
    console.log(`[${i + 1}/${cases.length}] ${page.title} (${page.urlPath})`);

    const acf = await checkAcfRender(page, SITE_URL);
    const links = await checkLinks(page, SITE_URL);
    const cf7 = page.forms && page.forms.length > 0 ? await checkCf7(page, SITE_URL) : null;
    const visualDiffResult = visualDiff.getResult(page.file);
    const a11y = findA11yEntry(a11yMap, page);

    checkResultsByPageId[page.id] = { acf, links, cf7, visualDiff: visualDiffResult, a11y };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const c1 = renderC1Markdown(model, checkResultsByPageId);
  fs.writeFileSync(path.join(OUT_DIR, 'test-spec.md'), c1);

  const c3Tsv = renderC3Tsv(model, checkResultsByPageId);
  fs.writeFileSync(path.join(OUT_DIR, 'l1-checklist.tsv'), c3Tsv);

  const c3Guide = renderC3Guide();
  fs.writeFileSync(path.join(OUT_DIR, 'l1-guide.md'), c3Guide);

  let autoOk = 0;
  let autoNg = 0;
  for (const page of cases) {
    const r = checkResultsByPageId[page.id];
    autoOk += r.acf.missing.length === 0 ? 1 : 0;
    autoNg += r.acf.missing.length === 0 ? 0 : 1;
    autoOk += r.links.broken.length === 0 ? 1 : 0;
    autoNg += r.links.broken.length === 0 ? 0 : 1;
    if (page.forms && page.forms.length > 0) {
      const ok = !!(r.cf7 && r.cf7.rendered);
      autoOk += ok ? 1 : 0;
      autoNg += ok ? 0 : 1;
    }
  }
  const flagged = model.pages.filter(p => p.kind === 'unknown' || p.unresolved === true);

  console.log('');
  console.log('=== サマリー ===');
  console.log(`テストケース数: ${cases.length}`);
  console.log(`自動チェック OK: ${autoOk}件 / NG: ${autoNg}件`);
  console.log(`要確認ページ（種別不明 or 投稿未解決）: ${flagged.length}件`);
  if (flagged.length > 0) {
    for (const p of flagged) console.log(`  - ${p.id} (${p.file})`);
  }
  console.log('');
  // ガイドの HTML 版も続けて出す。**別コマンドにすると呼び忘れる。**
  // 絵が無ければ絵なしで出る（gen-guide-html が自分で判断する）。
  {
    const { spawnSync } = require('child_process');
    const r = spawnSync('node', [path.join(__dirname, 'gen-guide-html.js'), REPO_ROOT], { encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.status !== 0) process.stderr.write(r.stderr || '');
  }

  console.log('出力先:');
  console.log(`  ${path.join(OUT_DIR, 'test-spec.md')}`);
  console.log(`  ${path.join(OUT_DIR, 'l1-checklist.tsv')}`);
  console.log(`  ${path.join(OUT_DIR, 'l1-guide.md')}`);
  {
    const h = path.join(OUT_DIR, 'l1-guide.html');
    if (fs.existsSync(h)) console.log(`  ${h}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
