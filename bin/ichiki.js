#!/usr/bin/env node
'use strict';

// Ichiki の単一入口。個々の道具は src/ にあるが、覚えるのはここだけでよい。
//
// 道具が proposal / scripts / 本体の3箇所に21本散っていた状態を1本化したもの。
// 「前あったアレが無い」を防ぐため、**使えるものは必ずここに出る**。

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const ROOT = path.join(__dirname, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// [コマンド, 実体, 引数の説明, 一行説明]
const COMMANDS = [
  ['lint',        [SRC, 'lint', 'lint.js'],            '<mockup> [--json] [--allow-unresolved-links]', 'モックが制約語彙に適合しているか'],
  ['a11y',        [SRC, 'a11y', 'check.js'],           '<mockup> [--json] [--site <URL>] [--report <path>]',                            'pa11y + axe（WCAG2AA）'],
  ['scan',        [SRC, 'scan.js'],                    '<mockup> <out> [--project <名前>] [--allow-unresolved-links]',                            'acf-map.yaml / coverage.json / CLAUDE.md'],
  ['build',       [SRC, 'converter', 'convert.js'],    '<mockup> <出力先> [--acf-map <yaml>]',         'WordPress テーマを生成'],
  ['verify',      [SRC, 'verify', 'coverage.js'],      '<mockup> <theme>',                             '宣言 → the_field() が出力されているか'],
  ['verify:structure', [SRC, 'verify', 'structure.js'],'<mockup> <theme>',                             'モックの class が生成物に残っているか'],
  ['verify:live', [SRC, 'verify', 'live.js'],          '<mockup> <URL>',                               '公開後のサイトを取得して突き合わせる'],
  ['snapshot',    [SRC, 'snapshot.js'],                '<mockup> <expected.json> [--update]',          '出力を凍結し、変わったら落とす'],
  ['diff',        [SRC, 'visual', 'diff.js'],          '<モックルート> <比較先URL> [出力先]', 'モック ↔ 比較先URL のピクセル比較（WP でも旧モックでも）'],
  ['diff:crop',   [SRC, 'visual', 'crop.js'],          '<ラベル> [y] [高さ]',                           '差分の塊を一覧／位置指定で切り出す'],
  ['testspec',    [SRC, 'testspec', 'generate.js'],    '[案件ルート]',                                  'C1 テスト仕様書 / C3 検収シート / C3付録'],
  ['release',     [SRC, 'release', 'generate.js'],    '[案件ルート]', '本番リリース手順書（エックスサーバー向け）'],
  ['pa11yci',     [SRC, 'testspec', 'gen-pa11yci.js'], '[案件ルート]',                                  '.pa11yci.json を生成'],
  ['gate',        [SRC, 'gate.js'],                    '<mockup> [--allow-unresolved-links] [--snapshot <json>]', '上を順に流す。最初に落ちたところで止まる'],
  ['deliver',     [SRC, 'deliver.js'],                 '[サイトURL] [--no-visual]', '公開後の検査と検収成果物を順に流す（サイトが要る）'],
  ['publish-mockup', [SRC, 'publish-mockup.js'],      '<置き先> [--remove]', 'モックを配る（合意前にお客様へ見せる用）'],
  ['serve',       [SRC, 'serve.js'],                   '[mockup] [port]',                              'モックを配信するだけの静的サーバ'],
  ['doctor',      [SRC, 'doctor.js'],                  '[案件ルート]',                                 '案件側の受け入れ状態（依存・設定・コマンドのコピー）'],
  ['selftest',    null,                                '',                                             'Ichiki 自身の検査（scan回帰・ルール同期・負のテスト）'],
];

function usage() {
  console.log(`ichiki ${VERSION} — 制約付きモックアップ → WordPress\n`);
  console.log('使い方: ichiki <コマンド> [引数]\n');
  const w = Math.max(...COMMANDS.map((c) => c[0].length));
  for (const [name, , args, desc] of COMMANDS) {
    console.log(`  ${name.padEnd(w)}  ${desc}`);
    if (args) console.log(`  ${' '.repeat(w)}    ${args}`);
  }
  console.log('\n  --version         バージョンを表示');
}

// 案件が想定している Ichiki のバージョンと、いま動いている本体が食い違っていないか。
//
// 案件ごとに submodule のコミットを固定する運用なので、
// 「案件Aで直した機能が案件Bに無い」が起きる。**起きること自体は防げない**ので、
// せめて気づけるようにする。.ichiki.json の ichiki_version と照合するだけ。
function checkVersion(args) {
  // 値を取るオプションの値を位置引数と取り違えない（gate の --snapshot で踏んだ）。
  const VALUE_OPTS = new Set(['--snapshot', '--acf-map', '--project']);
  const dir = args.find((a, i) => !a.startsWith('--') && !VALUE_OPTS.has(args[i - 1])) || process.cwd();
  for (const base of [dir, process.cwd()]) {
    const f = path.join(path.resolve(base), '.ichiki.json');
    if (!fs.existsSync(f)) continue;
    let want;
    try { want = JSON.parse(fs.readFileSync(f, 'utf8')).ichiki_version; } catch { return; }
    if (!want) {
      console.error(`※ ${path.relative(process.cwd(), f)} に ichiki_version がありません（現在 ${VERSION}）。`);
      console.error('   案件が想定するバージョンを書いておくと、食い違いに気づけます。');
    } else if (want !== VERSION) {
      console.error(`※ バージョン不一致: 案件は ${want} を想定、いま動いているのは ${VERSION}`);
      console.error('   submodule のコミットを合わせるか、.ichiki.json を更新してください。');
    }
    return;
  }
}

function run(script, args) {
  const r = spawnSync('node', [script, ...args], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

function selftest() {
  let bad = 0;
  for (const [label, f] of [
    ['scan の回帰', 'run.js'],
    ['ルール同期', 'check-rule-sync.js'],
    ['負のテスト', 'verify-rules.js'],
  ]) {
    const r = spawnSync('node', [path.join(ROOT, 'test', f)], { encoding: 'utf8' });
    const ok = r.status === 0;
    console.log(`${ok ? '✓' : '✗'} ${label}`);
    if (!ok) {
      console.log((r.stdout || '') + (r.stderr || ''));
      bad++;
    }
  }
  process.exit(bad ? 1 : 0);
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === '--help' || cmd === '-h') { usage(); process.exit(0); }
if (cmd === '--version' || cmd === '-v') { console.log(VERSION); process.exit(0); }
if (cmd === 'selftest') selftest();

const hit = COMMANDS.find((c) => c[0] === cmd);
if (!hit) {
  console.error(`知らないコマンドです: ${cmd}\n`);
  usage();
  process.exit(2);
}
checkVersion(rest);
run(path.join(...hit[1]), rest);
