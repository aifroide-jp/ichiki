#!/usr/bin/env node
'use strict';

// 案件側の受け入れ状態を見る。
//   node src/doctor.js [案件ルート]
//
// なぜ要るか:
//   Ichiki は submodule で、スラッシュコマンドは .claude/commands/ に**コピー**して使う
//   （Claude Code が .claude/commands/ しか見ないため）。
//   本体を更新してコピーを忘れると、**古い手順が動き続ける**。しかも静かに。
//   実測: commands/run.md を新しい手順に書き換えたのに、案件側は8月5日のコピーのままで、
//   /run を叩けば「AI が1ページずつテンプレートを書く」旧手順が動く状態だった。
//   書き換えた本人（私）が塞げたと思い込んでいた。
//
//   コピーをやめる案もあったが、更新手順を踏めば済む話ではある。
//   **踏み忘れても気づけるようにする**のがここの役目。

const fs = require('fs');
const path = require('path');

const ICHIKI = path.join(__dirname, '..');
const ROOT = path.resolve(process.argv[2] || process.cwd());
const VERSION = JSON.parse(fs.readFileSync(path.join(ICHIKI, 'package.json'), 'utf8')).version;

const problems = [];
const notes = [];

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function ng(msg, how) {
  console.log(`✗ ${msg}`);
  problems.push(how);
}

// 0. 手元の道具
//
// Ichiki の中しか見ていなかったが、揃っていないと後の工程で分かりにくく落ちる。
// 実測: wp-cli が消えていて、seed の投入が「Could not open input file」で止まった。
// ここで先に言えば、何が足りないか一目で分かる。
{
  const { spawnSync } = require('child_process');
  const ver = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.status !== 0 && !r.stdout) return null;
    return String(r.stdout || r.stderr).split('\n')[0].trim();
  };
  const REQUIRED = [
    ['node', ['--version'], 'https://nodejs.org/ から入れる（18以上）'],
    ['npm', ['--version'], 'node と一緒に入る'],
    ['git', ['--version'], 'Xcode Command Line Tools か https://git-scm.com/'],
  ];
  // 使う工程が限られるもの。無くても止めないが、そのとき何ができないかを言う。
  const OPTIONAL = [
    ['php', ['--version'], 'gate の php -l がスキップされる（テーマの文法検査ができない）'],
    ['wp', ['--version'], 'wp-cli。初期データの投入を手で叩くときに要る'],
  ];
  for (const [cmd, args, how] of REQUIRED) {
    const v = ver(cmd, args);
    if (v) ok(`${cmd} がある（${v}）`);
    else ng(`${cmd} が無い`, how);
  }
  for (const [cmd, args, why] of OPTIONAL) {
    const v = ver(cmd, args);
    if (v) ok(`${cmd} がある（${v}）`);
    else notes.push(`${cmd} が無い。${why}`);
  }
  // WordPress をどこで動かすかは案件次第。Local.app は代表的な選択肢なので見るだけ見る。
  if (process.platform === 'darwin' && !fs.existsSync('/Applications/Local.app')) {
    notes.push('Local.app が見つからない。WordPress を動かす環境が別にあるなら問題ない');
  }
}

// 1. 本体の依存
if (fs.existsSync(path.join(ICHIKI, 'node_modules', 'cheerio'))) {
  ok('Ichiki の依存が入っている');
} else {
  ng('Ichiki の依存が入っていない', `cd ${path.relative(ROOT, ICHIKI) || '.'} && npm install`);
}

// 2. .ichiki.json
const confPath = path.join(ROOT, '.ichiki.json');
let conf = null;
if (fs.existsSync(confPath)) {
  try {
    conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    ok('.ichiki.json がある');
  } catch (e) {
    ng('.ichiki.json が壊れている（JSON として読めない）', '書式を直してください');
  }
} else {
  ng('.ichiki.json が無い', 'README の「はじめに」を見て作成してください');
}

// 3. バージョンの記録と一致
if (conf) {
  if (!conf.ichiki_version) {
    ng('.ichiki.json に ichiki_version が無い', `"ichiki_version": "${VERSION}" を書いてください`);
  } else if (conf.ichiki_version !== VERSION) {
    ng(
      `バージョン不一致（案件は ${conf.ichiki_version} を想定 / 本体は ${VERSION}）`,
      'submodule のコミットを合わせるか .ichiki.json を更新してください'
    );
  } else {
    ok(`バージョンが一致している（${VERSION}）`);
  }
  if (!conf.mockup) notes.push('.ichiki.json に mockup が無い（コマンドで毎回パスを渡すことになる）');
  for (const k of ['theme_dir', 'site_url']) {
    if (!conf[k]) ng(`.ichiki.json の ${k} が空`, '環境に合わせて書いてください（scan は埋められません）');
  }
  // 書いてあっても**実際に届くか**は別。ポートが被って別のサイトが応答することがある。
  // 実測: Local はサイトを作り直すとポートが変わり、site_url が別サイトを指していた。
  if (conf.theme_dir && !fs.existsSync(path.dirname(conf.theme_dir))) {
    ng(
      `.ichiki.json の theme_dir の親フォルダが無い: ${path.dirname(conf.theme_dir)}`,
      'WordPress の themes フォルダの場所を確認してください（Local ならサイトを起動してから）'
    );
  }
  if (conf.site_url) {
    const r = require('child_process').spawnSync(
      'curl',
      ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '4', conf.site_url],
      { encoding: 'utf8' }
    );
    const code = (r.stdout || '').trim();
    if (code === '000' || code === '') {
      ng(
        `${conf.site_url} に繋がらない`,
        'WordPress を起動してください（Local ならサイトを Start）。ポートが変わっていないかも確認'
      );
    } else {
      ok(`${conf.site_url} に繋がる（HTTP ${code}）`);
    }
  }
  // 構造化が途中の宣言。規約（rules/ichiki.md「モックの置き場所」）から外れた配置を
  // 宣言された逸脱として扱う。**残件を数字で出す**。書いたまま忘れられるのが一番まずい。
  if (conf.retrofit) {
    const beforeDir = path.resolve(ROOT, conf.retrofit.before || '.');
    const mockDir = path.resolve(ROOT, conf.mockup || '.');
    const count = (d) => {
      let n = 0;
      const walk = (x) => {
        if (!fs.existsSync(x)) return;
        for (const e of fs.readdirSync(x, { withFileTypes: true })) {
          if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
          const f = path.join(x, e.name);
          if (e.isDirectory()) { if (f !== mockDir) walk(f); }
          else if (e.name.endsWith('.html')) n++;
        }
      };
      walk(d);
      return n;
    };
    const before = count(beforeDir);
    const after = count(mockDir);
    notes.push(
      `構造化が途中（.ichiki.json の retrofit 宣言）: 変換前 ${before}ページ / 変換済み ${after}ページ` +
        (conf.retrofit.note ? `\n     ${conf.retrofit.note}` : '') +
        '\n     この間は未解決リンクが警告に落ち、生成したテーマが管理画面に警告を出す。' +
        `\n     終わったら retrofit を消し、${conf.retrofit.before || 'before'} を削除すること。`
    );
  }
  if (!conf.title_separator) {
    notes.push('.ichiki.json に title_separator が無い（既定 " | " で扱う。scan を回すと書き込まれる）');
  } else if (conf.title_separator !== ` ${String(conf.title_separator).trim()} `) {
    ng(
      `.ichiki.json の title_separator ${JSON.stringify(conf.title_separator)} は前後に半角空白が必要`,
      'WordPress が区切りを空白で囲んで結合するため、"｜" のような形は再現できません'
    );
  }
}

// 4. スラッシュコマンドのコピーが本体と同じか
const srcDir = path.join(ICHIKI, 'commands');
const dstDir = path.join(ROOT, '.claude', 'commands');
if (fs.existsSync(srcDir)) {
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
  const stale = [];
  const missing = [];
  for (const f of files) {
    const dst = path.join(dstDir, f);
    if (!fs.existsSync(dst)) {
      missing.push(f);
    } else if (fs.readFileSync(dst, 'utf8') !== fs.readFileSync(path.join(srcDir, f), 'utf8')) {
      stale.push(f);
    }
  }
  const extra = fs.existsSync(dstDir)
    ? fs.readdirSync(dstDir).filter((f) => f.endsWith('.md') && !files.includes(f))
    : [];

  if (!stale.length && !missing.length && !extra.length) {
    ok(files.length ? `スラッシュコマンドのコピーが本体と一致している（${files.length}件）` : 'スラッシュコマンドは使っていない');
  } else {
    if (stale.length) ng(`コピーが古い: ${stale.join(', ')}`, `cp ${path.relative(ROOT, srcDir)}/*.md .claude/commands/`);
    if (missing.length) ng(`コピーが無い: ${missing.join(', ')}`, `cp ${path.relative(ROOT, srcDir)}/*.md .claude/commands/`);
    if (extra.length) ng(`本体に無いコマンドが残っている: ${extra.join(', ')}`, `.claude/commands/ から削除してください`);
  }
}

for (const n of notes) console.log(`  ※ ${n}`);

if (problems.length) {
  console.log('');
  console.log('直し方:');
  for (const p of [...new Set(problems)]) console.log(`  ${p}`);
  process.exit(1);
}
console.log('');
console.log('問題ありません。');
