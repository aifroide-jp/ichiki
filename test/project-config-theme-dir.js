'use strict';
// 回帰テスト: テーマの配置先(themeDir)とテーマ名(themeSlug)の計算。
//
// 経緯: .ichiki.json の theme_dir（配置先の絶対パスを直書き）は、末尾のテーマ
// フォルダ名を theme_slug と別々に手で一致させる必要があり、実測でズレて
// 古い名前（"nkk-poc"）のまま本番に出そうになっていた。
// wp_root（Localがサイトを置くディレクトリ）+ local_site_container（この案件の
// サイトのフォルダ名）+ theme_slug から機械的に組み立てる形に直した。
//
//   node test/project-config-theme-dir.js

const path = require('path');
const { themeDir, themeSlug } = require('../src/shared/project-config');

let failed = false;
function check(name, got, want) {
  if (got === want) {
    console.log(`OK: ${name}`);
  } else {
    console.error(`NG: ${name}\n  got : ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
    failed = true;
  }
}

// theme_dir の直書きは互換のため最優先される
check(
  'theme_dir を直書きしていれば、それを優先する',
  themeDir({ theme_dir: '/explicit/path', wp_root: '/x', local_site_container: 'y', theme_slug: 'z' }),
  '/explicit/path'
);

// wp_root + local_site_container + theme_slug から機械的に組み立てる
check(
  'wp_root/local_site_container/theme_slug から配置先を計算する',
  themeDir({ wp_root: '/Users/x/Local Sites', local_site_container: 'mysite', theme_slug: 'myslug' }),
  path.join('/Users/x/Local Sites', 'mysite', 'app', 'public', 'wp-content', 'themes', 'myslug')
);

// theme_dir も wp_root も無ければ null（呼び出し側が止める）
check('どちらも無ければ null', themeDir({}), null);

// wp_root はあっても local_site_container が無ければ null
check('local_site_container が無ければ null', themeDir({ wp_root: '/x' }), null);

// theme_slug 未設定なら <project>_theme
check('theme_slug 未設定時は <project>_theme', themeSlug({ project: 'foo' }), 'foo_theme');

// theme_slug を明示していればそれを使う
check('theme_slug を明示していればそれを使う', themeSlug({ project: 'foo', theme_slug: 'bar' }), 'bar');

if (failed) process.exit(1);
console.log('RESULT: themeDir/themeSlug の計算は正しく動いています');
