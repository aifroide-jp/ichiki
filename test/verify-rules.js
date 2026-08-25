#!/usr/bin/env node
'use strict';

// lint のルールが**実際に違反を検出できるか**を確かめる（負のテスト）。
//
//   node test/verify-rules.js
//
// test/mockup-bad/ はわざと全ルールに違反させたモック。ここに lint をかけて、
// 語彙に載っている有効ルールが**1つ残らず発火するか**を見る。発火しないルールがあれば落ちる。
//
// なぜ要るか:
//   ルールを実装しても「違反する例で試していない」と、通ったのが
//   「違反が無いから」なのか「検出できていないから」なのか区別がつかない。
//   実際、L26 は実データでたまたま発火したので機能を確認できたが、
//   L27・L29 は書いただけで一度も発火していなかった。
//
// これがあると「ルールを足したのに違反例を書き忘れる」が構造的に起きなくなる。
// 人が手順を守る必要がない。**ルールを追加したら mockup-bad にも違反例を足すこと。**
//
// 注意: mockup-bad は lint が通ってはいけないので gate.js の検査対象にはしない。

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VOCAB = path.join(ROOT, 'rules', 'vocabulary.md');
const BAD = path.join(ROOT, 'test', 'mockup-bad');

// 語彙のルール表から有効なルールIDを取る（欠番は除く）。
// check-rule-sync.js と同じ考え方だが、あちらは「3者に揃っているか」、
// こちらは「実際に発火するか」を見る。
function activeRuleIds() {
  const text = fs.readFileSync(VOCAB, 'utf8');
  const retired = new Set();
  const start = text.indexOf('### 9.0 欠番');
  if (start >= 0) {
    const rest = text.slice(start);
    const end = rest.search(/\n#{2,3} /);
    const section = end < 0 ? rest : rest.slice(0, end);
    for (const m of section.matchAll(/^\|\s*(L\d{2})\s*\|/gm)) retired.add(m[1]);
  }
  const ids = new Set();
  for (const m of text.matchAll(/^\|\s*(L\d{2})\s*\|/gm)) ids.add(m[1]);
  for (const id of retired) ids.delete(id);
  return [...ids].sort();
}

function main() {
  if (!fs.existsSync(BAD)) {
    console.error(`違反モックがありません: ${BAD}`);
    process.exit(2);
  }

  const r = spawnSync('node', [path.join(ROOT, 'src', 'lint', 'lint.js'), BAD, '--json'], { encoding: 'utf8' });
  let issues;
  try {
    const parsed = JSON.parse(r.stdout);
    issues = parsed.issues || parsed;
  } catch (e) {
    console.error('lint の JSON 出力を読めませんでした:');
    console.error((r.stdout || '') + (r.stderr || ''));
    process.exit(2);
  }

  const fired = new Map(); // ルールID -> 件数
  for (const i of issues) fired.set(i.rule, (fired.get(i.rule) || 0) + 1);

  const expected = activeRuleIds();
  const missing = expected.filter((id) => !fired.has(id));
  const unexpected = [...fired.keys()].filter((id) => !expected.includes(id)).sort();

  console.log('ルールID   発火   件数');
  for (const id of expected) {
    const n = fired.get(id) || 0;
    console.log(`  ${id}     ${n > 0 ? ' ○ ' : ' ✗ '}   ${n}`);
  }
  console.log('');

  if (unexpected.length) {
    console.log(`欠番のはずのルールが発火しています: ${unexpected.join(' ')}`);
  }
  if (missing.length === 0 && unexpected.length === 0) {
    console.log(`RESULT: 全 ${expected.length} ルールが違反を検出できました`);
    process.exit(0);
  }
  if (missing.length) {
    console.log(`RESULT: ${missing.length}件のルールが発火しませんでした`);
    console.log(`  ${missing.join(' ')}`);
    console.log('');
    console.log('  「違反が無い」のではなく「検出できていない」可能性があります。');
    console.log('  test/mockup-bad/ に違反例を足すか、ルールの実装を見直してください。');
  }
  process.exit(1);
}

main();
