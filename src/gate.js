#!/usr/bin/env node
'use strict';

// 検証ゲートを一括で流す。**最初に落ちたところで止める。**
//
//   node proposal/gate.js [mockupDir] [オプション]
//
//     --allow-unresolved-links  未解決の内部リンクを警告に落として変換を続行する
//     --snapshot <expected.json> 出力の凍結と突き合わせる（案件側の期待値ファイル）
//
// 個々のツールは README.md の「ゲート一覧」に説明がある。ここはその順番を固定するだけで、
// 検査の中身は一切持たない（持つと N 個目の実装になる）。
//
// --allow-unresolved-links について:
//   本番案件ではモック＝全ページなので、未解決リンクは本当の不具合であり、
//   このオプションを使う理由が無い。
//   一方この PoC は 51ページ中 11ページだけを書き直したサンプルなので、
//   書いていないページへのリンクは解決しなくて当然であり、恒久的に必要になる。
//   どちらの意味で渡しているかを、実行のたびに出力へ明示する。

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');   // Ichiki のルート
const SRC = __dirname;
const argv = process.argv.slice(2);
// 未解決リンクを警告に落とすかどうか。
// フラグでも指定できるが、**構造化が途中なら宣言から導く**。
// 変換していないページへのリンクは途中である以上必ず出るので、
// 毎回手で付けさせるのは意味がない。付け忘れて落ちるのも、
// 惰性で付け続けて本当の不具合を見逃すのも避けたい。
// 宣言から来た場合も、下で必ず警告文を出す（黙って許さない）。
const allowUnresolvedFlag = argv.includes('--allow-unresolved-links');
// 値を取るオプションの値を、位置引数と取り違えない。
// 実測: --snapshot の値がモックのパスとして拾われ、期待値ファイルをスキャンしていた。
const VALUE_OPTS = new Set(['--snapshot']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.has(argv[i - 1]));

// モックの置き場所は .ichiki.json が持っている（既定 mockup: "./"）。
// 本番の案件はリポジトリ直下がモックなので、引数を書かせない。引数があればそちらが優先。
function config() {
  const f = path.join(process.cwd(), '.ichiki.json');
  if (!fs.existsSync(f)) return {};
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
}
const CONF = config();
const RETROFIT = CONF.retrofit || null;
const allowUnresolved = allowUnresolvedFlag || !!RETROFIT;
const mockupDir = positional[0] || CONF.mockup || null;
if (!mockupDir) {
  console.error('モックの場所が分かりません。引数で渡すか、.ichiki.json に mockup を書いてください。');
  console.error('使い方: ichiki gate [mockupDir] [--allow-unresolved-links] [--snapshot <json>]');
  process.exit(2);
}

// 作業用ディレクトリ。案件リポジトリを汚さないよう一時領域に置く。
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ichiki-gate-'));
const themeDir = path.join(workDir, 'theme');
const scanDir = path.join(workDir, 'scan');

// 検査には2種類ある。
//
//   連鎖（blocking）: 前段が壊れると後段の結果が無意味になるもの。
//                     lint → scan → 変換 → 生成物の検証。ここは落ちたら止める。
//   独立（blocking:false）: 他の検査の前提にならないもの。a11y とピクセル比較。
//                     コントラスト比が悪くても変換は正しく動く。
//
// 以前は全部を同列に止めていたため、a11y が落ちるとテーマが生成されなかった。
// 依存していないものを止めるのは、ゲートの設計としてただの誤りだった。
// 独立した検査の失敗は記録して続行するが、**最終的な終了コードは非ゼロ**にする。
const steps = [];
function step(name, cmd, args, opts = {}) {
  steps.push({ name, cmd, args, blocking: true, ...opts });
}

// 1. ルール自体が健全か（語彙・lint・プロンプトの3者が揃っているか）
step('ルール同期', 'node', [path.join(ROOT, 'test', 'check-rule-sync.js')]);

// 2. モックが規約に適合しているか
step('lint', 'node', [
  path.join(SRC, 'lint', 'lint.js'),
  mockupDir,
  // L30 の「行き先がモックにありません」は変換器の未解決リンクと同じ事実なので、
  // 片方だけ止めると「lint は通らないが変換は通る」というちぐはぐな状態になる。
  ...(allowUnresolved ? ['--allow-unresolved-links'] : []),
]);

// 3. アクセシビリティ（モック段階で通す）
// 変換は色に依存しないので、落ちても後段は続行する。
step('a11y', 'node', [path.join(SRC, 'a11y', 'check.js'), mockupDir], { blocking: false });

// 4. テキストの取りこぼしがゼロか／acf-map.yaml が出るか
step('scan', 'node', [
  path.join(SRC, 'scan.js'),
  mockupDir,
  scanDir,
  ...(allowUnresolved ? ['--allow-unresolved-links'] : []),
]);

// 5. テーマ生成
step(
  '変換',
  'node',
  [
    path.join(SRC, 'converter', 'convert.js'),
    mockupDir,
    themeDir,
    ...(allowUnresolved ? ['--allow-unresolved-links'] : []),
    // scan が出した acf-map.yaml と突き合わせる。
    // 読み取り自体は同じ実装（converter/lib）に寄せてあるので、ここで割れるのは
    // 「台帳が古い」か「モデルの経路が2つに分かれた」かのどちらか。どちらも事故なので止める。
    '--acf-map', path.join(scanDir, 'acf-map.yaml'),
  ]
);

// 6. 生成物の検証（宣言の出力漏れ／class の消失）
step('フィールド突合', 'node', [path.join(SRC, 'verify', 'coverage.js'), mockupDir, themeDir]);
step('構造忠実性', 'node', [path.join(SRC, 'verify', 'structure.js'), mockupDir, themeDir]);

// 6.5 出力の凍結（回帰ハーネス）
// 出力が変わったら、どのファイルが変わったかを名指しで出す。
// **意図した変更なら --update で凍結し直す。**黙って通さない。
//
// 当初は移設中だけの道具のつもりだったが、**構造化中の安全網**として要る。
// 実測: 12ページのモックに13ページ目を足すと、増えるのはそのページの3ファイルだけで、
// 既存12ページのテンプレートと ACF は1つも変わらなかった。
// 変わるのは集約ファイル（functions.php / seed-*.php / retrofit-notice.php）のみ。
// つまり「既存ページが動いたら事故」という信号が取れる。ページを足すたびに効く。
//
// 期待値は案件側にある（案件ごとに中身が違う）。--snapshot で場所を渡す。
// 渡されなければこのステップは飛ばす（初回や、まだ凍結していない案件のため）。
const snapArg = argv.indexOf('--snapshot');
const snapshotPath = snapArg >= 0 ? argv[snapArg + 1] : null;
if (snapshotPath) {
  step('出力の凍結', 'node', [path.join(SRC, 'snapshot.js'), mockupDir, snapshotPath]);
}

// 7. PHP の構文（php が無い環境ではスキップし、スキップした旨を必ず出す）
step('php -l', null, null, { php: true });

// ピクセル比較は gate に入れない。
//
// **合意前のモックは見た目が変わるのが正しい。** お客様に見せて直す工程が何周も回る。
// そこへ旧モックとのピクセル比較を毎回かけると、正しい変更が毎回 FAIL になる。
// 見た目の固定が要るのは retrofit（宣言を後付けする局面）だけなので、
// そのときに `ichiki diff` を明示的に叩く。
//
// 実際、以前は --visual で compare.js を引数なしで呼んでいて**常に失敗していた**。
// blocking:false だったので gate は続行し、誰も気づかないまま残っていた。

function runPhpLint() {
  const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    return { status: 0, output: '', skipped: 'php が見つからないためスキップしました' };
  }
  const files = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.php')) files.push(p);
    }
  })(themeDir);
  if (files.length === 0) return { status: 1, output: 'テーマに .php が1つもありません' };
  const bad = [];
  for (const f of files) {
    const r = spawnSync('php', ['-l', f], { encoding: 'utf8' });
    if (r.status !== 0) bad.push((r.stdout || '') + (r.stderr || ''));
  }
  return { status: bad.length ? 1 : 0, output: bad.join('\n'), note: `${files.length}ファイル` };
}

function main() {
  console.log(`対象: ${mockupDir}`);
  if (allowUnresolved) {
    console.log(
      RETROFIT && !allowUnresolvedFlag
        ? '※ .ichiki.json の retrofit 宣言により、未解決の内部リンクを警告に落としています。'
        : '※ --allow-unresolved-links: 未解決の内部リンクを警告に落としています。'
    );
    console.log('   本番案件では使わないこと（モック＝全ページなので未解決＝不具合）。');
  }
  console.log('');

  const failures = [];
  const warned = [];
  let stoppedAt = null;

  for (const s of steps) {
    const r = s.php
      ? runPhpLint()
      : (() => {
          const p = spawnSync(s.cmd, s.args, { encoding: 'utf8' });
          return { status: p.status, output: (p.stdout || '') + (p.stderr || '') };
        })();

    if (r.status !== 0) {
      failures.push({ name: s.name, output: r.output, blocking: s.blocking });
      if (s.blocking) {
        console.log(`✗ ${s.name}  ← ここで停止（後段はこの結果に依存するため）`);
        stoppedAt = s.name;
        break;
      }
      console.log(`✗ ${s.name}  （変換はこれに依存しないので続行）`);
      continue;
    }
    // 通ったステップでも**警告は握りつぶさない**。
    // 実測: acf-map.yaml との値の食い違い39件が warn で、gate には ✓ としか出ず、
    // 「問題が出るようにした」つもりで誰にも見えていなかった。
    // 通った段でも警告は隠さない。gate は各段の出力を捨てるので、
    // 数だけでも出しておかないと「問題を見えるようにする」目的を達成できない。
    // 件数は各段が自分で申告した「警告 N 件」を採る（拾い集めた行数を数えると
    // 見出し行まで1件に数えてしまい、実測で 28件 を 1件 と表示していた）。
    const declared = (r.output || '').match(/警告 (\d+) 件/);
    const warnCount = declared ? Number(declared[1]) : 0;
    const tail =
      (r.skipped ? `（${r.skipped}）` : r.note ? `（${r.note}）` : '') +
      (warnCount ? `  ※ 警告 ${warnCount} 件` : '');
    console.log(`✓ ${s.name}${tail}`);
    if (warnCount) warned.push({ name: s.name, output: r.output });
  }

  console.log('');

  if (warned.length) {
    console.log('');
    for (const w of warned) {
      console.log(`===== ${w.name} の警告 =====`);
      console.log(w.output.trimEnd());
      console.log('');
    }
  }

  if (failures.length === 0) {
    console.log(`全ゲート通過。生成テーマ: ${themeDir}`);
    process.exit(0);
  }

  for (const f of failures) {
    console.log(`===== ${f.name} の出力 =====`);
    console.log(f.output.trimEnd());
    console.log('');
  }

  if (stoppedAt) {
    console.log(`${stoppedAt} で停止しました。テーマは生成していません。`);
  } else {
    console.log(`テーマは生成しました: ${themeDir}`);
    console.log(`ただし ${failures.map((f) => f.name).join(' / ')} が失敗しています。`);
  }
  process.exit(1);
}

main();
