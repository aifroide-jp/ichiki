#!/usr/bin/env node
'use strict';

// 公開後のサイトに対する検査と、検収成果物の生成を束ねる。
//
// なぜ要るか:
//   gate は「モック → テーマ」を束ねているが、公開後の側は束ねるものが無く、
//   4本を正しい順で手で叩く必要があった。しかも**欠けても止まらない**。
//   diff と a11y を先に回さないと、testspec が「未実行」のまま成果物を出す。
//   人が順番を覚えている前提の設計だった。
//
// gate との違いは**動いているサイトが要る**こと。したがって URL を必須にする
// （.ichiki.json の site_url を既定にする）。
//
//   ichiki gate      モック → テーマ        （サイト不要）
//   （デプロイ）
//   ichiki deliver   公開後のサイト → 成果物 （サイト必要）

const path = require('path');
const { spawnSync } = require('child_process');
const { readConfig } = require('./shared/project-config');

const SRC = __dirname;
const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const ROOT = process.cwd();
const { conf } = readConfig(ROOT);

const siteUrl = (positional[0] || conf.site_url || '').replace(/\/$/, '');
if (!siteUrl) {
  console.error('サイトの URL が分かりません。引数で渡すか、.ichiki.json に site_url を書いてください。');
  console.error('使い方: ichiki deliver [サイトURL]');
  process.exit(2);
}
const mockupDir = conf.mockup || './';
const visualOut = (conf.testspec && conf.testspec.visual_report) || 'docs/visual';
const skipVisual = argv.includes('--no-visual'); // 撮影は数分かかるので、要らないときは飛ばせる

const steps = [];
function step(name, args, opts = {}) {
  steps.push({ name, args, blocking: true, ...opts });
}

// 1. 宣言どおりに出ているか（成果物の前提。ここが崩れていたら中身を測る意味がない）
step('公開後の検証', [path.join(SRC, 'verify', 'live.js'), mockupDir, siteUrl], {
  blocking: false,
  detail: `ichiki verify:live ${mockupDir} ${siteUrl}`,
});

// 2〜3. 見た目とアクセシビリティ。**testspec より前に置く**（レポートを読むため）
if (!skipVisual) {
  step('見た目の比較', [path.join(SRC, 'visual', 'diff.js'), mockupDir, siteUrl, visualOut, '--both'], {
    blocking: false,
    detail: `ichiki diff ${mockupDir} ${siteUrl} ${visualOut} --both`,
  });
}
step('アクセシビリティ', [path.join(SRC, 'a11y', 'check.js'), mockupDir, '--site', siteUrl], {
  blocking: false,
  detail: `ichiki a11y ${mockupDir} --site ${siteUrl}`,
  // AA違反があっても成果物は出す。違反そのものは C1 に記録され、直すかは別の判断。
});

// 3.5 合意したモックを公開サイトの配下に置く。
// **testspec より前**。検収シートに「合意したデザイン」の URL を載せるかは
// 実際に置かれているかで決まるため。
step('モックの配置', [path.join(SRC, 'publish-mockup.js')], {
  blocking: false,
  detail: 'ichiki publish-mockup',
});

// 4. 検収成果物（C1 / C3 / ガイド）
step('検収成果物', [path.join(SRC, 'testspec', 'generate.js'), ROOT]);

// 5. リリース手順書
step('リリース手順書', [path.join(SRC, 'release', 'generate.js'), ROOT]);

function main() {
  console.log(`対象サイト: ${siteUrl}`);
  console.log(`モック: ${mockupDir}`);
  if (skipVisual) console.log('※ --no-visual: 見た目の比較を飛ばします（C1 の表示確認は「未実行」になります）');
  console.log('');

  const failures = [];
  let stoppedAt = null;

  for (const s of steps) {
    const p = spawnSync('node', s.args, { encoding: 'utf8' });
    const out = (p.stdout || '') + (p.stderr || '');
    if (p.status !== 0) {
      failures.push({ name: s.name, output: out, blocking: s.blocking, detail: s.detail });
      if (s.blocking) {
        console.log(`✗ ${s.name}  ← ここで停止（後段はこの結果に依存するため）`);
        stoppedAt = s.name;
        break;
      }
      console.log(`✗ ${s.name}  （成果物はこれに依存しないので続行）`);
      continue;
    }
    // 各段が申告した件数を拾って1行にする（gate と同じ作法）
    const m =
      /要確認ページ[^:]*: (\d+)件/.exec(out) ||
      /RESULT: (\d+)件の不一致/.exec(out) ||
      /行き先の無いリンク: (\d+)/.exec(out);
    console.log(`✓ ${s.name}${m ? `  （${m[0]}）` : ''}`);
  }

  console.log('');

  // 落ちた段の出力を全部貼らない。実測で506行になり、読まれない量だった。
  // **要約の1行と、詳細を見るコマンド**だけ出す。
  // 詳細は各コマンドを単体で叩けば同じものが出るので、失われない。
  for (const f of failures) {
    const summary =
      (/RESULT: .*$/m.exec(f.output) || [])[0] ||
      (/errors \(.*$/m.exec(f.output) || [])[0] ||
      f.output.trim().split('\n').pop() ||
      '（出力なし）';
    console.log(`✗ ${f.name}: ${summary.trim()}`);
    if (f.detail) console.log(`    詳細: ${f.detail}`);
  }
  if (failures.length) console.log('');

  if (stoppedAt) {
    console.log(`${stoppedAt} で停止しました。成果物は出していません。`);
    process.exit(1);
  }
  if (failures.length) {
    console.log('RESULT: FAIL（成果物は出しましたが、上の検査が落ちています）');
    process.exit(1);
  }
  console.log('RESULT: OK');
}

main();
