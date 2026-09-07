#!/usr/bin/env node
'use strict';

// 構造化の後始末。**案件で1回しかやらないので、手順を覚えている前提にしない。**
//
// retrofit 宣言を消すと2つ変わるが、どちらも画面に出ないまま効く:
//   1. 未解決リンクが警告から error に戻る（converter/convert.js の
//      errors.allowUnresolvedLinks = allowUnresolvedLinks || !!retrofit）。
//      つまり**消してから gate を回して初めて本当の合格が分かる。**
//   2. 生成テーマの「変換途中です」通知（inc/retrofit-notice.php）が出なくなる。
//      配置済みのテーマには残っているので、作り直さないと管理画面に出続ける。
//
// このコマンドは案件のファイルを触るところまでをまとめてやり、
// WordPress 側を書き換える build 以降は**案内だけ**にする（勝手に走らせない）。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { readConfig, writeConfig, DEFAULT_BEFORE_DIR } = require('./shared/project-config');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const { path: confPath, conf } = readConfig(ROOT);

if (!confPath) {
  console.error('.ichiki.json が見つかりません。案件のルートで実行してください。');
  process.exit(2);
}

const beforeDir = path.resolve(path.dirname(confPath), (conf.retrofit && conf.retrofit.before) || DEFAULT_BEFORE_DIR);
const hasDecl = !!conf.retrofit;
const hasDir = fs.existsSync(beforeDir);

if (!hasDecl && !hasDir) {
  console.log('構造化の後始末はもう済んでいます（retrofit 宣言も合意デザインもありません）。');
  process.exit(0);
}

// --- 消す前に、git に残っているかを確かめる ---
//
// 合意デザインは「見た目の正」で、消すと戻せない。コミットさえされていれば
// git show <コミット>:<パス> で取り出せるので、そこだけは機械で確認する。
if (hasDir) {
  const git = (...args) => spawnSync('git', ['-C', path.dirname(confPath), ...args], { encoding: 'utf8' });
  if (git('rev-parse', '--is-inside-work-tree').status !== 0) {
    console.error(`git の管理下ではないため、${path.relative(ROOT, beforeDir)} を消せません。`);
    console.error('  合意デザインは消すと戻せません。先にコミットするか、手で退避してください。');
    process.exit(1);
  }
  const tracked = git('ls-files', '--', beforeDir).stdout.trim();
  if (!tracked) {
    console.error(`${path.relative(ROOT, beforeDir)} がコミットされていません。`);
    console.error('  消すと戻せません。先にコミットしてください。');
    process.exit(1);
  }
  const dirty = git('status', '--porcelain', '--', beforeDir).stdout.trim();
  if (dirty) {
    console.error(`${path.relative(ROOT, beforeDir)} に未コミットの変更があります。`);
    console.error(dirty.split('\n').map((l) => `    ${l}`).join('\n'));
    console.error('  消すと戻せません。先にコミットしてください。');
    process.exit(1);
  }
}

// --- 1. 宣言を消す ---
if (hasDecl) {
  const next = { ...conf };
  delete next.retrofit;
  writeConfig(confPath, next);
  console.log(`✓ ${path.basename(confPath)} から retrofit 宣言を消しました`);
}

// --- 2. 合意デザインを消す ---
if (hasDir) {
  fs.rmSync(beforeDir, { recursive: true, force: true });
  console.log(`✓ ${path.relative(ROOT, beforeDir)} を消しました（履歴から取り出せます）`);
  // 中身が無くなった .ichiki/ を残さない。git は空ディレクトリを追跡しないので、
  // 消し忘れると「手元にだけある空の隠しフォルダ」が残り続ける。
  const parent = path.dirname(beforeDir);
  if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
}

// --- 3. 未解決リンクが error に戻った状態で通るか ---
console.log('');
console.log('未解決リンクが error に戻りました。この状態で通るか gate で確かめます。');
console.log('');
const gate = spawnSync(process.execPath, [path.join(__dirname, 'gate.js'), conf.mockup || './'], {
  cwd: path.dirname(confPath),
  stdio: 'inherit',
});
// gate は終了コードで理由を分ける（1=連鎖が壊れた / 2=独立した検査だけ落ちた）。
// ここを取り違えると、色のコントラスト（デザイン側の課題）を「後始末に失敗した」と
// 誤報告することになる。
if (gate.status === 1) {
  console.error('');
  console.error('gate が止まりました。宣言に守られていた不整合が出た可能性があります。');
  console.error('  よくあるのは、構造化していないページへのリンクが残っているケースです。');
  console.error('  ※ 後始末（宣言と合意デザインの削除）自体は完了しています。');
  process.exit(1);
}
if (gate.status === 2) {
  console.log('');
  console.log('変換は通りました。落ちたのは独立した検査（a11y など）だけです。');
  console.log('  後始末とは無関係の、デザイン側の課題として別に扱ってください。');
}

// --- 4. ここから先は WordPress 側を触るので案内だけ ---
console.log('');
console.log('次にやること（このコマンドでは実行しません）:');
console.log('  1. node .claude/ichiki/bin/ichiki.js build');
console.log('     → 配置済みテーマの「変換途中です」通知（inc/retrofit-notice.php）が消えます');
console.log('  2. WordPress の管理画面を1回開く');
console.log('  3. node .claude/ichiki/bin/ichiki.js deliver');
console.log('     → 検収成果物とリリース手順書から「構造化が途中」の但し書きが消えます');
