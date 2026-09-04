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
const { themeDir, readConfig } = require('../shared/project-config');

// 案件のルート（.ichiki.json / acf-map.yaml がある場所）を引数で受け取る。
//   node src/testspec/generate.js <案件ルート>
// 出力先・形式は .ichiki.json の testspec 節で上書きできる。書かなければ既定。
const REPO_ROOT = path.resolve(process.argv[2] || process.cwd());
const ICHIKI_JSON = path.join(REPO_ROOT, '.ichiki.json');
if (!fs.existsSync(ICHIKI_JSON)) {
  console.error(`.ichiki.json がありません: ${ICHIKI_JSON}`);
  process.exit(2);
}
// **自分で JSON.parse しない。** 案件の事実（.ichiki.json）とそのPCの値
// （.ichiki.local.json）のマージは readConfig が唯一の実装。直読みすると、
// 分離済みの案件で wp_root / site_url が見えず「配置先がありません」で止まる。
const ICHIKI = readConfig(REPO_ROOT).conf;
const TS = ICHIKI.testspec || {};
const ACF_MAP_PATH = path.join(REPO_ROOT, 'acf-map.yaml');
// テーマの配置先は themeDir() が唯一の実装（shared/project-config.js）。
// ここで ICHIKI.theme_dir を直読みしていたため、wp_root + local_site_container で
// 書かれた案件では undefined になり、path.join() の TypeError スタックだけが出ていた
// （実測: deliver の「検収成果物」が "}" とだけ表示して停止し、理由が読めなかった）。
const THEME_DIR = themeDir(ICHIKI);
if (!THEME_DIR) {
  console.error('.ichiki.json にテーマの配置先がありません。');
  console.error('  wp_root と local_site_container（推奨）、または theme_dir を書いてください。');
  process.exit(2);
}
if (!fs.existsSync(THEME_DIR)) {
  console.error(`テーマがまだ配置されていません: ${THEME_DIR}`);
  console.error('  先に ichiki build でテーマを出してください（検収成果物はテーマの中身から作ります）。');
  process.exit(2);
}
const SITE_URL = ICHIKI.site_url;
const OUT_DIR = path.resolve(REPO_ROOT, TS.out_dir || 'docs/検収');
const A11Y_REPORT_PATH = path.resolve(REPO_ROOT, TS.a11y_report || 'pa11y-report.json');

// 合意デザインを成果物の中へ複製する。戻り値は TSV から見た相対の基点。
//
// モックのルートを丸ごとコピーしない。案件のルートがモックそのものである場合
// （mockup: "./"）、docs/ や node_modules、.git まで巻き込む。
// 語彙が置き場所を固定している構成要素（ページ + css/ js/ images/）だけを写す。
function bundleDesign(mockupDir, outDir, pages) {
  const dest = path.join(outDir, 'design');
  fs.rmSync(dest, { recursive: true, force: true });
  for (const p of pages) {
    const from = path.join(mockupDir, p.file);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, p.file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  for (const dir of ['css', 'js', 'images']) {
    const from = path.join(mockupDir, dir);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dest, dir), { recursive: true });
  }
  return 'design';
}

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

  // 「合意したデザイン」の列。**成果物と一緒にモックを配る。**
  //
  // 以前は file:// + 生成したPCの絶対パスを書いていた。C3 は社内スタッフに渡す
  // 書類なので、**渡した相手のPCでは必ず開けない**
  // （実測(maruya案件): 全行に file:///Users/<個人名>/… が入っていた。
  //  自分でもリポジトリを別の場所へ置き直した時点で開けなくなる）。
  //
  // docs/検収/design/ にモックを複製し、相対パスで指す。こうすると
  //   - 渡したフォルダごと、どのPCでも開ける
  //   - **検収時点のデザインが凍結される**。あとからモックを直しても、
  //     「何に対して OK を出したのか」が書類の中に残る
  const mockupBase = bundleDesign(path.resolve(REPO_ROOT, ICHIKI.mockup || './'), OUT_DIR, model.pages);

  const c3Tsv = renderC3Tsv(model, checkResultsByPageId, mockupBase);
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
    const r = spawnSync(process.execPath, [path.join(__dirname, 'gen-guide-html.js'), REPO_ROOT], { encoding: 'utf8' });
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
