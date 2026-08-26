#!/usr/bin/env node
'use strict';

// 案件に Ichiki を入れる。**submodule を追加したあと、案件のルートで1回だけ叩く。**
//
//   node .claude/ichiki/bin/ichiki.js setup
//
// なぜ node で書くか:
//   最初は setup.sh（シェル）だったが、**Windows の PowerShell に sh が無い**。
//   実測: `sh: The term 'sh' is not recognized...` で動かなかった。
//   .bat を併置する手もあるが、2つ持てば必ずズレる。
//   Ichiki は node で動くのだから、node で書けば1つで済む。
//
// 手打ちする行が多いと、どれかを飛ばしても気づけない
// （実測: コマンドのコピーを忘れて旧手順が動き続けた）。順番に流して、最後に doctor で確認する。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);

// **cwd に頼らない。** 自分は .claude/ichiki/bin/setup.js なので、
// そこから案件のルートを逆算できる。どこから叩かれても同じ場所を見る。
const ICHIKI = path.join(__dirname, '..');
const ROOT = path.join(ICHIKI, '..', '..');
const BIN = path.join(ICHIKI, 'bin', 'ichiki.js');

function has(cmd) {
  // Windows は where、それ以外は command -v。shell:true で PATHEXT も効かせる。
  const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
  return spawnSync(probe, { shell: true, stdio: 'ignore' }).status === 0;
}

// **shell: true を使わない。**
// Windows で node の実体は "C:\Program Files\nodejs\node.exe" のように空白を含む。
// 起動の仕方が2種類ある。**混ぜると必ずどちらかが壊れる。**
//
// npm / npx（PATH から引く名前）
//   Windows では実体が npm.cmd で、Node 18.20.2 / 20.12.2 以降は
//   .cmd / .bat を shell 無しで起動すると **EINVAL** になる（CVE-2024-27980 対応）。
//   実測: npm が一度も動かないまま「✗ npm install に失敗しました」だけが出た。
//   npm のメッセージが無いのはこのため。→ shell:true が要る。
//
// process.execPath（絶対パス）
//   "C:\Program Files\nodejs\node.exe" のように空白を含むので、
//   shell:true にすると 'C:\Program' で切れる。→ shell:false でなければならない。
//
// 名前で引くものだけ shell に通す。引数に空白は無い（install / --no-audit 等）。
function run(cmd, args, opts = {}) {
  const viaShell = process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx');
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...(viaShell ? { shell: true } : {}), ...opts });
  // **error を握りつぶさない。** 以前は ENOENT だけ見ていたので、
  // EINVAL のように「起動すらできなかった」場合が無言になっていた。
  if (r.error) {
    if (r.error.code === 'ENOENT') console.error(`✗ ${cmd} が見つかりません`);
    else console.error(`✗ ${cmd} を起動できませんでした（${r.error.code || r.error.message}）`);
    return false;
  }
  return r.status === 0;
}

// 自分自身（Ichiki のコマンド）を呼ぶ。node の実体をそのまま使うので確実。
function ichiki(args, opts = {}) {
  return run(process.execPath, [BIN, ...args], opts);
}

if (!fs.existsSync(path.join(ICHIKI, 'package.json'))) {
  console.error('✗ .claude/ichiki がありません。先に submodule を入れてください:');
  console.error('');
  console.error('  git submodule add https://github.com/aifroide-jp/ichiki .claude/ichiki');
  console.error('  git submodule update --init --recursive');
  process.exit(2);
}

// --- 手元の道具を先に見る ---
// 無いまま進むと `npm: command not found` だけが出て、
// **何を入れればいいか分からない画面**になる（実測）。
// node は見ない。**このスクリプト自体が node で動くので、無ければここへ来られない。**
// （その場合に出るのは `node: command not found` だけ。案内は README 側に置く）
// npm は node と一緒に入るのが普通だが、入れ方によっては欠けることがあるので見る。
const REQUIRED = [
  ['npm', 'node と一緒に入ります。https://nodejs.org/ から入れ直してください'],
  ['git', process.platform === 'win32' ? 'https://git-scm.com/download/win' : 'Xcode Command Line Tools（xcode-select --install）か https://git-scm.com/'],
];
// 動いてはいるが古い node かもしれない。それはここで見られる。
{
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error(`✗ node が古すぎます（いま v${process.versions.node} / 18以上が要ります）`);
    console.error('    https://nodejs.org/ から入れ直してください');
    process.exit(2);
  }
}

const missing = REQUIRED.filter(([c]) => !has(c));
if (missing.length) {
  for (const [c, how] of missing) {
    console.error(`✗ ${c} がありません`);
    console.error(`    ${how}`);
  }
  console.error('');
  console.error('上を入れてから、もう一度このコマンドを流してください。');
  process.exit(2);
}

// 無くても進めるが、後の工程で効くもの。ここで言っておく。
{
  const { findPhp } = require('../src/shared/wp-env');
  const php = findPhp(has);
  if (!php) {
    console.log('※ php がありません。gate の php -l（テーマの文法検査）が飛ばされます');
    console.log('   Local を入れれば同梱の php を使うので、別途入れる必要はありません。');
  } else if (php.from !== 'PATH') {
    console.log(`✓ php は ${php.from} を使います`);
  }
}
// --- 手元の WordPress を探す ---
// **アプリの実行ファイルは探さない**（理由は src/shared/wp-env.js の頭）。
// Local のサイト台帳を読む。見つかれば .ichiki.json に貼る値まで出せる。
const { localSites, herdInstalled, themeDirFor, localSitesFile } = require('../src/shared/wp-env');
const sites = localSites();
const herd = herdInstalled(has);

if (sites.length) {
  console.log(`✓ Local のサイトが ${sites.length}件あります`);
  for (const s of sites) {
    console.log(`   ${s.name}  ${s.url}${s.exists ? '' : '  ※ wp-config.php が無い（未作成かも）'}`);
  }
  console.log('');
  console.log('   .ichiki.json にはこう書きます（theme_slug は案件名）:');
  const s = sites[0];
  console.log(`     "site_url":  "${s.url}"`);
  console.log(`     "theme_dir": ${JSON.stringify(themeDirFor(s, '<theme_slug>'))}`);
} else if (herd) {
  console.log('✓ Herd があります');
  console.log('   サイトの場所は Herd 側で決まるので、.ichiki.json の');
  console.log('   site_url と theme_dir はご自分で書いてください。');
} else {
  // ここで初めて案内する。**入っている人には出さない。**
  // 実測: 以前はこの文を無条件に出していたため、Local が入っている Windows で
  // 「入っていない」と読まれた。
  console.log('※ WordPress を動かす環境が見つかりません。どちらかを入れてください。');
  console.log('   Local  https://localwp.com/   （こちらが前提。サイト台帳を読んで自動で見つけます）');
  console.log('   Herd   https://herd.laravel.com/');
  console.log(`   Local を入れてあるのに出るときは、台帳が見つかっていません: ${localSitesFile()}`);
  console.log('   後で .ichiki.json の site_url と theme_dir にその場所を書きます。');
}

if (!has('wp')) {
  console.log('');
  console.log('※ wp-cli がありません（無くても構いません）');
  console.log('   初期データは管理画面を1回開けば入ります。コマンドで叩きたいときだけ要ります。');
  if (sites.length) {
    console.log('   Local のサイトを右クリック →「Open site shell」で wp が使えます。');
  } else if (process.platform === 'darwin') {
    console.log('   自分で入れるなら: brew install wp-cli （または https://wp-cli.org/#installing）');
  } else if (process.platform === 'win32') {
    console.log('   自分で入れるなら: https://wp-cli.org/#installing （Windows は Git Bash か WSL が要ります）');
  } else {
    console.log('   自分で入れるなら: https://wp-cli.org/#installing');
  }
}
console.log('');

// 壊れた node_modules の消し方は cmd と PowerShell で違う（rmdir /s /q は cmd 専用）。
// **シェルの構文を人に当てさせない。** 自分で消す。
if (argv.includes('--clean')) {
  for (const d of ['node_modules']) {
    const t = path.join(ICHIKI, d);
    if (fs.existsSync(t)) {
      fs.rmSync(t, { recursive: true, force: true });
      console.log(`削除しました: ${path.join('.claude', 'ichiki', d)}`);
    }
  }
}

console.log('1/4 依存を入れます（初回は1分ほど）');
// **--silent を付けない。** 実測: 付けていたせいで npm が何を言ったか見えず、
// 「✗ npm install に失敗しました」だけが残って原因が分からなかった。
// 進捗の見栄えより、落ちたときに読めることを取る。
if (!run('npm', ['install', '--no-audit', '--no-fund'], { cwd: ICHIKI })) {
  console.error('');
  console.error('✗ npm install に失敗しました。上に npm のメッセージが出ています。');
  console.error('  よくある原因:');
  console.error('   - ネットワーク / プロキシ（社内網なら npm config set proxy が要ることがあります）');
  console.error('   - 途中で壊れた node_modules → 消してやり直します（シェルの違いは気にしなくて構いません）:');
  console.error('       node .claude/ichiki/bin/setup.js --clean');
  console.error('  それでも直らないときは、上の npm のメッセージをそのまま貼ってください。');
  process.exit(1);
}

// chromium は「見た目の比較」だけでなく **アクセシビリティ検査にも使う**。
// puppeteer の Chrome ダウンロードを .npmrc で止めた分、ここが本体になった。
console.log('2/4 ブラウザを入れます（見た目の比較とアクセシビリティ検査に使います。初回は数分）');
if (!run('npx', ['--yes', 'playwright', 'install', 'chromium'], { cwd: ICHIKI })) {
  console.log('    ※ 入りませんでした。ichiki diff と ichiki a11y が使えません。');
  console.log('       あとで入れ直せます: node .claude/ichiki/bin/setup.js');
}

console.log('3/4 スラッシュコマンドを配置します');
{
  const src = path.join(ICHIKI, 'commands');
  const dst = path.join(ROOT, '.claude', 'commands');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.md'))) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

console.log('4/4 案件設定とフィールド台帳を作ります');
if (!ichiki(['scan'])) {
  // 理由は scan 自身が出している（モックが無い / 規約に合っていない / リンクが解決しない）。
  // ここで決めつけると外れる。実測: 合意デザインだけ置いた状態で
  // 「規約に合っていない可能性があります」と出て、誤った方向へ誘導していた。
  console.error('');
  console.error('✗ ここで止まりました。上に理由が出ています。');
  console.error('  直してから、もう一度このコマンドを流してください。');
  console.error('  ここまでの1〜3（依存・ブラウザ・コマンド配置）は済んでいます。');
  process.exit(1);
}

console.log('');
ichiki(['doctor']);
console.log('');
console.log('──────────────────────────────────────────');
console.log('残りは手で書いてください（機械には分かりません）:');
console.log('');
console.log('  .ichiki.json の theme_dir  … WordPress の themes フォルダの場所');
console.log('  .ichiki.json の site_url   … 開発中のサイトの URL');
console.log('');
console.log('書いたら `node .claude/ichiki/bin/ichiki.js doctor` で確認できます。');
