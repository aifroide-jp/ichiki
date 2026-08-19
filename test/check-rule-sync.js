#!/usr/bin/env node
'use strict';

// 語彙（rules/vocabulary.md）と lint 実装（src/lint/rules/*.js）にズレが無いかを、
// ルールID（L01〜）の存在で機械的に照合する。
//
// なぜ要るか: 同じルールを複数箇所で実装・記述すると必ず乖離する。
// 実際に本検証中、相対パス化の際に lint だけ直して変換器が取り残され、
// 18件のエラーで停止した。文章で「二重管理しない」と書いても守られない。
//
// このチェックは「IDが両方に存在するか」しか見ない（内容の一致までは見ない）。
// ID の欠落＝どちらかを更新し忘れた、という最も起きやすい事故だけを確実に捕まえる。
//
// **生成プロンプトは照合対象から外した。**
// 以前は3者（語彙・lint・プロンプト）を見ていたが、プロンプトが規約を再掲していたのが前提。
// 規約を語彙の1次参照だけにし、プロンプトからルールの記述を無くしたので、
// ルールIDを要求する意味が無くなった（要求すると再掲を強制することになる）。
// 実測: 再掲していた頃は data-acf-type が15箇所 / wysiwyg が20箇所で二重に書かれ、
// **ID は揃っているのに内容がズレる**状態だった。ID の一致は内容の一致を保証しない。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VOCAB = path.join(ROOT, 'rules', 'vocabulary.md');
const RULES_DIR = path.join(ROOT, 'src', 'lint', 'rules');

const idsIn = (text) => new Set((text.match(/\bL\d{2}\b/g) || []));

// 「### 9.0 欠番（削除したルール）」の表に載っている ID を拾う。
// 欠番は有効ルールではないので、語彙に書いてあっても lint 実装を要求しない。
// 逆に「削除したはずなのに実装に残っている」ことは検出する。
function retiredIdsIn(text) {
  const start = text.indexOf('### 9.0 欠番');
  if (start < 0) return new Set();
  const rest = text.slice(start);
  const end = rest.search(/\n#{2,3} /);
  const section = end < 0 ? rest : rest.slice(0, end);
  const ids = new Set();
  // 表の行（| L17 | … |）だけを対象にする。本文中の言及は拾わない。
  for (const m of section.matchAll(/^\|\s*(L\d{2})\s*\|/gm)) ids.add(m[1]);
  return ids;
}

function main() {
  const vocabText = fs.readFileSync(VOCAB, 'utf8');
  const retired = retiredIdsIn(vocabText);
  const vocab = idsIn(vocabText);
  for (const id of retired) vocab.delete(id);

  // lint 側は「ルールIDを実際に発行しているか」で見る（コメントだけの言及は数えない）。
  // 発行の書き方は2通りある:
  //   - mk(page, 'L01', ...) の第2引数            … 単一ページのルール
  //   - { rule: 'L16', ... } / 引数として 'L09'   … ページ横断のルール
  // どちらも「コード中に文字列リテラルとして現れる」ので、コメント行を除いた上で拾う。
  const impl = new Set();
  for (const f of fs.readdirSync(RULES_DIR)) {
    if (!f.endsWith('.js')) continue;
    const src = fs
      .readFileSync(path.join(RULES_DIR, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n');
    for (const m of src.matchAll(/'(L\d{2})'/g)) impl.add(m[1]);
  }

  const all = [...new Set([...vocab, ...impl])].filter((id) => !retired.has(id)).sort();
  const rows = all.map((id) => ({ id, vocabulary: vocab.has(id), lint: impl.has(id) }));

  // 削除したルールが実装に残っていないかを逆向きに見る。
  // 消し忘れると「語彙には無いのに検査だけされる」状態になり、
  // モックを書く側からは理由の分からない指摘として現れる。
  const zombies = [...retired].filter((id) => impl.has(id)).sort();

  const bad = rows.filter((r) => !(r.vocabulary && r.lint));

  console.log('ルールID   語彙  lint');
  for (const r of rows) {
    const mark = (b) => (b ? ' ○ ' : ' ✗ ');
    console.log(`  ${r.id}    ${mark(r.vocabulary)}  ${mark(r.lint)}`);
  }
  console.log('');
  if (retired.size > 0) {
    console.log(`欠番（削除済み・番号は再利用しない）: ${[...retired].sort().join(' ')}`);
    console.log('');
  }
  if (bad.length === 0 && zombies.length === 0) {
    console.log(`RESULT: 語彙と lint が揃っています（有効 ${rows.length}ルール / 欠番 ${retired.size}件）`);
    process.exit(0);
  }
  for (const id of zombies) {
    console.log(`  ${id}: 欠番のはずが lint 実装に残っています`);
  }
  if (bad.length === 0) process.exit(1);
  console.log(`RESULT: ${bad.length}件のズレがあります`);
  for (const r of bad) {
    const missing = [!r.vocabulary && 'vocabulary.md', !r.lint && 'lint 実装'].filter(Boolean);
    console.log(`  ${r.id}: ${missing.join(' / ')} に無い`);
  }
  process.exit(1);
}

main();
