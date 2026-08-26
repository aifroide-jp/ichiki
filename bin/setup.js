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

const ROOT = process.cwd();
const ICHIKI = path.join(ROOT, '.claude', 'ichiki');
const BIN = path.join(ICHIKI, 'bin', 'ichiki.js');

function has(cmd) {
  // Windows は where、それ以外は command -v。shell:true で PATHEXT も効かせる。
  const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
  return spawnSync(probe, { shell: true, stdio: 'ignore' }).status === 0;
}

// **shell: true を使わない。**
// Windows で node の実体は "C:\Program Files\nodejs\node.exe" のように空白を含む。
// shell:true にすると Program で切れて「'C:\Program' は認識されていません」になる。
// npm / npx は Windows では .cmd なので、そこだけ拡張子を足して直接呼ぶ。
function run(cmd, args, opts = {}) {
  const real = process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx') ? `${cmd}.cmd` : cmd;
  const r = spawnSync(real, args, { stdio: 'inherit', ...opts });
  if (r.error && r.error.code === 'ENOENT') {
    console.error(`✗ ${cmd} が見つかりません`);
    return false;
  }
  return r.status === 0;
}

// 自分自身（Ichiki のコマンド）を呼ぶ。node の実体をそのまま使うので確実。
function ichiki(args, opts = {}) {
  return run(process.execPath, [BIN, ...args], opts);
}

if (!fs.existsSync(ICHIKI)) {
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
if (!has('php')) {
  console.log('※ php がありません。gate の php -l（テーマの文法検査）が飛ばされます');
}
if (!has('wp')) {
  console.log('※ wp-cli がありません（無くても構いません）');
  console.log('   初期データは管理画面を1回開けば入ります。コマンドで叩きたいときだけ要ります。');
  if (fs.existsSync('/Applications/Local.app/Contents/Resources/extraResources/bin/wp-cli/wp-cli.phar')) {
    console.log('   Local を使うなら、サイトを右クリック →「Open site shell」で wp が使えます。');
  }
  console.log('   自分で入れるなら: brew install wp-cli （または https://wp-cli.org/#installing）');
}
console.log('※ WordPress を動かす環境が要ります。');
console.log('   Local  https://localwp.com/');
console.log('   Herd   https://herd.laravel.com/');
console.log('   後で .ichiki.json の site_url と theme_dir にその場所を書きます。');
console.log('');

console.log('1/4 依存を入れます（初回は数分かかります）');
if (!run('npm', ['install', '--silent'], { cwd: ICHIKI })) {
  console.error('✗ npm install に失敗しました');
  process.exit(1);
}

console.log('2/4 見た目の比較に使うブラウザを入れます');
if (!run('npx', ['--yes', 'playwright', 'install', 'chromium'], { cwd: ICHIKI, stdio: 'ignore' })) {
  console.log('    ※ 入りませんでした。ichiki diff を使うときに入れ直してください');
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
if (!ichiki(['scan', '.', '.'])) {
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
