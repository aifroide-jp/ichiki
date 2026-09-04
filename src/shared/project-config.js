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

// そのPCでしか正しくない値の置き場所。**コミットしない**（.gitignore に入れる）。
//
// なぜ分けるか: 案件の事実（project / mockup / title_separator / retrofit など）は
// クローンした全員に同じものが要るのでコミットすべきだが、Local の置き場所や
// サイトのポートは人ごとに違う。1つのファイルに混ざっていると
// 「コミットしたくないが、しないと他の人が動かせない」という詰み方をする。
// 実測(maruya案件): wp_root に個人のホームディレクトリ、site_url に Local が
// 割り当てたポートが入っており、コミットの是非が決められなくなった。
const LOCAL_FILENAME = '.ichiki.local.json';

// 環境依存のキー。ここに挙げたものだけが LOCAL_FILENAME 側へ行く。
// theme_dir は旧来の書き方（配置先の直書き）で、これも環境依存。
const LOCAL_KEYS = ['wp_root', 'local_site_container', 'theme_dir', 'site_url'];

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

// Windows のパスをそのまま貼ると `\` が単独で残る。JSON では `\t` `\n` のような
// 制御文字のエスケープとして解釈され、**パースが通ってしまい値が静かに壊れる**
// 組み合わせがある（実測: "C:\temp\newsite" が "C:<TAB>emp<改行>ewsite" になった）。
// `\t` `\n` はそれ単体では**正しい JSON エスケープ**なので、JSON の妥当性だけでは
// 「意図した制御文字」と「Windowsパスの区切りの書き間違い」を区別できない。
// そこで先に「ドライブレターの直後の単一 \」というパターンで拾う
// （`C:\` の直後に別の `\` が続かなければ、正しいエスケープではあり得ない）。
function hasSuspiciousBackslash(raw) {
  if (/[A-Za-z]:\\(?!\\)/.test(raw)) return true;

  // それ以外の、有効なエスケープでない `\X`（`\\` は正しいペアとして読み飛ばす）。
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') continue;
    const next = raw[i + 1];
    if (next === '"' || next === '\\' || next === '/' || 'bfnrtu'.includes(next)) {
      i++; // 正しいエスケープ。ペアごと読み飛ばす
      continue;
    }
    return true;
  }
  return false;
}

function readJsonFile(p) {
  const raw = fs.readFileSync(p, 'utf8');
  // パースの成否によらず**必ず**警告する。\t / \n のような組み合わせは
  // パースエラーにならず、気づけないまま値が壊れるため。
  // ローカル設定（wp_root）こそ Windows のパスを貼る場所なので、両方に効かせる。
  if (hasSuspiciousBackslash(raw)) {
    console.error(
      `⚠ ${p}: \\（バックスラッシュ）が単独で使われています。` +
        'Windows のパスをそのまま貼ると起きます。JSON では \\t や \\n のような制御文字として' +
        '解釈され、パースが失敗するか、エラーにもならず値が静かに壊れます。' +
        '/（フォワードスラッシュ）に置き換えるか、\\\\ と2つ重ねてください。'
    );
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${p} が JSON として読めません: ${e.message}`);
  }
}

// 案件の事実（.ichiki.json、コミットする）に、そのPCの値（.ichiki.local.json、
// コミットしない）を上書きマージして返す。呼び出し側は今までどおり conf を見るだけでよい。
function readConfig(startDir) {
  const p = findConfigPath(startDir);
  if (!p) return { path: null, localPath: null, conf: {} };
  const conf = readJsonFile(p);
  const lp = path.join(path.dirname(p), LOCAL_FILENAME);
  if (!fs.existsSync(lp)) return { path: p, localPath: null, conf };
  return { path: p, localPath: lp, conf: { ...conf, ...readJsonFile(lp) } };
}

// 分離前の（PC依存の値が .ichiki.json に混ざったままの）案件かどうか。
// 分離を入れる前に作られた設定はこの形なので、次に書き込む機会があれば分けさせる。
// 値の中身は見ない。キーがそこにあること自体が「まだ分けていない」の印。
function needsLocalSplit(basePath) {
  if (!basePath || !fs.existsSync(basePath)) return false;
  let conf;
  try {
    conf = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  } catch {
    return false; // 壊れた JSON は readConfig 側が理由付きで落とす
  }
  return LOCAL_KEYS.some((k) => conf[k] !== undefined);
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

// 案件の事実とPC依存の値を、それぞれの置き場所へ書き分ける。
// 既に混ざった .ichiki.json があっても、次にここを通った時点で分離される。
function writeConfig(filePath, conf) {
  const base = {};
  const local = {};
  const put = (k, v) => {
    (LOCAL_KEYS.includes(k) ? local : base)[k] = v;
  };
  for (const k of ORDER) if (conf[k] !== undefined) put(k, conf[k]);
  for (const k of Object.keys(conf)) if (base[k] === undefined && local[k] === undefined) put(k, conf[k]);

  fs.writeFileSync(filePath, JSON.stringify(base, null, 2) + '\n', 'utf8');
  const localPath = path.join(path.dirname(filePath), LOCAL_FILENAME);
  if (Object.keys(local).length === 0) return { path: filePath, localPath: null };
  fs.writeFileSync(localPath, JSON.stringify(local, null, 2) + '\n', 'utf8');
  return { path: filePath, localPath };
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
  LOCAL_FILENAME,
  LOCAL_KEYS,
  DEFAULT_BEFORE_DIR,
  DEFAULT_PLUGINS,
  findConfigPath,
  readConfig,
  writeConfig,
  themeSlug,
  themeDir,
  needsLocalSplit,
  hasSuspiciousBackslash,
};
