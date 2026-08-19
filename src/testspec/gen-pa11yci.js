'use strict';
// acf-map.yaml のテストケースページ一覧から .pa11yci.json の urls を生成する。
// .claude/ichiki/.pa11yci.json（サブモジュール側のテンプレート）は書き換えない。
// ここで作るのは案件ローカルの scripts/test-spec/.pa11yci.json。
const fs = require('fs');
const path = require('path');

const { buildThemeModel, testCasePages } = require('./lib/theme-model');

const REPO_ROOT = path.resolve(process.argv[2] || process.cwd());
const ICHIKI = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.ichiki.json'), 'utf8'));
const ACF_MAP_PATH = path.join(REPO_ROOT, 'acf-map.yaml');
const OUT_PATH = path.join(REPO_ROOT, '.pa11yci.json');

function main() {
  const model = buildThemeModel({ acfMapPath: ACF_MAP_PATH, themeDir: ICHIKI.theme_dir, siteUrl: ICHIKI.site_url });
  const cases = testCasePages(model.pages);
  const urls = cases.map(p => p.liveUrl);

  const config = {
    defaults: { standard: 'WCAG2AA', runners: ['axe'] },
    urls,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log(`${urls.length}件のURLを ${OUT_PATH} に書き出した`);
}

main();
