'use strict';

// 案件設定（.ichiki.json）の読み書き。**唯一の実装。**
//
// モックの構造ではなく「案件の体裁・環境」を持つ。
//   project / mockup / theme_slug / wp_root / local_site_container / theme_dir /
//   site_url / ichiki_version / plugins_required
//
//   theme_slug            … 本番に置くテーマのフォルダ名（＝WordPressのテーマ名）。
//                            未設定なら `<project>_theme` を使う（`themeSlug()`）。
//                            **どの Local サイトを使うかとは無関係の、成果物側の名前。**
//                            本番リリース手順書（release/generate.js）が
//                            テーマ名・zip名・本番ビルドコマンドにそのまま使う。
//   wp_root               … Local がサイトを置いているディレクトリ（例: `~/Local Sites`）。
//                            1台のマシンでは全案件共通の値になることが多い。
//   local_site_container  … `wp_root` の直下にある、この案件のサイトのフォルダ名
//                            （例: `old-nature-kitakyushu-mock`）。案件名から機械的に
//                            決まらない（実測: `nature-kitakyushu` という案件名でも
//                            Local 側のフォルダは `old-nature-kitakyushu-mock` だった）ので、
//                            ここだけは人が書く。
//                            配置先は `themeDir()` が
//                              wp_root + '/' + local_site_container + '/app/public/wp-content/themes/' + theme_slug
//                            で機械的に組み立てる。Local 自身のサイト台帳（sites.json）は読まない
//                            （読むと「名前が変わっていたら」「台帳が壊れていたら」を
//                            考える必要が増える。wp_root と local_site_container の2つを
//                            素直にパス結合するほうが単純で壊れにくい）。
//   theme_dir             … 旧来の書き方（配置先そのものを直書き）。互換のため残す。
//                            書いてあれば wp_root/local_site_container より優先する。
//   title_separator ← `<title>` の区切り文字（ページごとに変わらないのでここ）
//   retrofit        ← 構造化が途中であることの宣言（下記）
//
// retrofit（既存モックを制約語彙に変換している最中だけ書く）:
//   { "before": "<変換前のモックの場所>", "note": "<状況>" }
//   これがあると規約（rules/ichiki.md「モックの置き場所」）から外れた配置を
//   **宣言された逸脱**として扱える。書かずに外れていると、ただの事故と区別が付かない。
//   未解決リンクを許すのもこの宣言に紐づく（変換していないページへのリンクは
//   途中である以上必ず出るため）。

const fs = require('fs');
const path = require('path');

const FILENAME = '.ichiki.json';

// 合意デザインの既定の置き場所（rules/ichiki.md「モックの置き場所」）。
// **このディレクトリがあること自体が「構造化が途中」の宣言**になる。
// 名前を規約で固定しているので、存在を読むのは推測ではない（data-common と同じ）。
// 設定に retrofit が無いまっさらなクローンでも、ここを見れば状態が分かる。
const DEFAULT_BEFORE_DIR = '.ichiki/mockup-before';

// 必須プラグイン（rules/ichiki.md「プロジェクト前提」）。案件で変わらないので既定に持つ。
const DEFAULT_PLUGINS = ['advanced-custom-fields', 'contact-form-7', 'safe-svg'];

// モックのディレクトリから上へ辿って探す。見つからなければ cwd を見る。
// 上へ辿るのは、モックが案件の下位にあることがあるため
// （convert 単体はモックのパスだけ渡され、設定は案件ルートにある）。
//
// **案件の境界（.git があるところ）で止める。**
// 際限なく辿ると、案件の外で叩いたときに親ディレクトリの別案件の設定を拾う。
// 実測: /tmp で lint を叩いたら、前の検証で置いた /tmp/.ichiki.json を拾い、
// 存在しない proposal/mockup-real を読もうとして落ちた。
function findConfigPath(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 12; i++) {
    const f = path.join(dir, FILENAME);
    if (fs.existsSync(f)) return f;
    // ここが案件のルート。これより上は別の案件（か、案件ですらない）。
    // **submodule では止めない。** submodule の .git は「ファイル」で、
    // 中身は親リポジトリを指す gitdir 参照。案件の境界ではない
    // （実測: .claude/ichiki の中から叩くと設定が見つからなくなった）。
    const dotGit = path.join(dir, '.git');
    if (fs.existsSync(dotGit) && fs.statSync(dotGit).isDirectory()) break;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const cwdFile = path.join(process.cwd(), FILENAME);
  return fs.existsSync(cwdFile) ? cwdFile : null;
}

function readConfig(startDir) {
  const p = findConfigPath(startDir);
  if (!p) return { path: null, conf: {} };
  try {
    return { path: p, conf: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    throw new Error(`${p} が JSON として読めません: ${e.message}`);
  }
}

// キーの並びを固定して書く。人が読むファイルなので、書き直すたびに順序が変わると差分が汚れる。
const ORDER = [
  'project',
  'mockup',
  'theme_slug',
  'wp_root',
  'local_site_container',
  'theme_dir',
  'site_url',
  'title_separator',
  'retrofit',
  'plugins_required',
  'ichiki_version',
];

function writeConfig(filePath, conf) {
  const out = {};
  for (const k of ORDER) if (conf[k] !== undefined) out[k] = conf[k];
  for (const k of Object.keys(conf)) if (out[k] === undefined) out[k] = conf[k];
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

// 本番のテーマ名。**環境依存のパスから導かない。**
// 未設定なら `<project>_theme`。project 自体が無ければ 'theme'。
function themeSlug(conf) {
  if (conf.theme_slug) return conf.theme_slug;
  return `${conf.project || 'theme'}_theme`;
}

// テーマの実際の配置先を1箇所で計算する。**呼び出し側ごとに組み立てさせない。**
// theme_dir（配置先を直書きする旧来の書き方）があれば互換のためそれを優先する。
// 無ければ wp_root + local_site_container + 'app/public/wp-content/themes' + theme_slug
// で機械的に組み立てる。wp_root か local_site_container が無ければ null
// （呼び出し側が「引数で渡すか設定に書け」で止める）。
function themeDir(conf) {
  if (conf.theme_dir) return conf.theme_dir;
  if (!conf.wp_root || !conf.local_site_container) return null;
  return path.join(conf.wp_root, conf.local_site_container, 'app', 'public', 'wp-content', 'themes', themeSlug(conf));
}

module.exports = {
  FILENAME,
  DEFAULT_BEFORE_DIR,
  DEFAULT_PLUGINS,
  findConfigPath,
  readConfig,
  writeConfig,
  themeSlug,
  themeDir,
};
