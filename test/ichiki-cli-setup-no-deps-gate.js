'use strict';
// 回帰テスト: `ichiki.js setup` が依存チェック(checkDeps)でブロックされないこと。
//
// 経緯(実測, monda-mockup-plan-a 案件): 新規 clone 直後（node_modules が無い状態）で
//   node .claude/ichiki/bin/ichiki.js setup
// を叩くと、checkDeps() が node_modules/cheerio の不在を理由に
//   「セットアップが終わっていません。案件のルートでこれを叩いてください:
//     node .claude/ichiki/bin/setup.js」
// と案内して即座に止まっていた。だが案内された setup.js こそが、
// COMMANDS テーブルで `setup` に紐付いている実体そのもの（bin/ichiki.js setup と
// bin/setup.js は同じスクリプト）。つまり setup は「依存を入れるコマンド」なのに、
// 依存が無いことを理由に自分自身の実行をブロックし、自分自身を実行しろと
// 案内するだけの無限ループになっていた。
//
// setup.js は fs/path/readline/child_process しか使わず(npm install より前の処理は)、
// cheerio 等の依存を必要としない。doctor と同様 NO_DEPS_NEEDED に入れて解決した。
//
// 実際に setup.js をフルで走らせる(npm install / playwright install / scan)のは
// 副作用が大きすぎるため、ここでは ichiki.js のソースを直接検査する
// （test/check-rule-sync.js と同じ、ソーステキストレベルの回帰ガード）。
//
//   node test/ichiki-cli-setup-no-deps-gate.js

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'ichiki.js'), 'utf8');

let failed = false;
function check(name, cond) {
  if (cond) console.log(`OK: ${name}`);
  else { console.error(`NG: ${name}`); failed = true; }
}

const m = src.match(/NO_DEPS_NEEDED\s*=\s*new Set\(\[([^\]]*)\]\)/);
check('NO_DEPS_NEEDED の定義が見つかる', !!m);

const names = m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) : [];
check('setup は依存チェックの対象外(NO_DEPS_NEEDED)である', names.includes('setup'));
check('doctor は依存チェックの対象外(NO_DEPS_NEEDED)である', names.includes('doctor'));

if (failed) process.exit(1);
console.log('RESULT: setup は依存が無くてもブロックされずに実行できます');
