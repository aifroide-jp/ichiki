#!/usr/bin/env node
'use strict';

// 本番リリース手順書を出す（rules/ichiki.md「成果物」の規定）。
//
// 読み手は**職員**であって開発者ではない。したがって:
//   - 機械が知っていることは全部埋める（プラグイン・URL・テンプレート・フォーム名）
//   - 機械が知りようのないこと（ドメイン・FTP・DB）は**空欄と明示**する。
//     それらしい値を書くと、確認せずにそのまま使われる
//   - 「まだ行き先の無いリンク」を必ず列挙する。リバース途中のまま公開すると
//     リンク切れが本番に出るので、手順書がその受け皿になる
//
// 入力はモックと .ichiki.json。テーマは見ない（テーマはモックから決まるため、
// 見に行くと「テーマを解析して推測する」古い作りに戻る）。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { findHtmlFiles } = require('../converter/lib/discover');
const { loadPage } = require('../converter/lib/load-page');
const { ErrorCollector } = require('../converter/lib/errors');
const { buildModel } = require('../converter/lib/model');
const { readConfig } = require('../shared/project-config');
const { archiveSlugOf, slugOfPageId } = require('../shared/site-urls');
const { orderOf } = require('../shared/page-order');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const { conf } = readConfig(ROOT);
const MOCKUP = path.resolve(ROOT, conf.mockup || './');
const OUT = path.resolve(ROOT, (conf.release && conf.release.out) || 'docs/リリース手順書.md');

// 検収成果物への相対リンク。出力先は .ichiki.json の testspec.out_dir で変えられるので、
// 手順書からの相対パスを計算して**リンクとして**貼る。
// パスを文字で書くだけだと、出力先を変えたときに黙って切れる。
const TESTSPEC_DIR = path.resolve(ROOT, (conf.testspec && conf.testspec.out_dir) || 'docs/検収');
function linkToTestspec(fileName, label) {
  const rel = path.relative(path.dirname(OUT), path.join(TESTSPEC_DIR, fileName)).split(path.sep).join('/');
  const exists = fs.existsSync(path.join(TESTSPEC_DIR, fileName));
  // まだ出していないなら、リンクではなく「先に出せ」と言う
  // encodeURI しない。日本語のパスがそのまま読めるほうが人にとって親切で、
  // GitHub もエディタも日本語パスのリンクを解決できる。
  // 空白だけはリンクが切れるので、そこだけ逃がす。
  const href = rel.replace(/ /g, '%20');
  return exists ? `[${label}](${href})` : `${label}（**未生成**。\`ichiki testspec\` を先に実行してください）`;
}

// そのリンクが data-nav の中に書かれているか
const navCache = new Map();
function isInNav(absFile, href) {
  if (!navCache.has(absFile)) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(fs.readFileSync(absFile, 'utf8'));
    const set = new Set();
    $('[data-nav] a[href]').each((_, a) => set.add($(a).attr('href')));
    navCache.set(absFile, set);
  }
  return navCache.get(absFile).has(href);
}

// --- 未解決リンクは lint L30 から取る（同じ判定を2度書かない） ---
function unresolvedLinks() {
  const lintJs = path.join(__dirname, '..', 'lint', 'lint.js');
  const r = spawnSync('node', [lintJs, MOCKUP, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  try {
    const j = JSON.parse(r.stdout);
    const seen = new Map();
    for (const i of j.issues || []) {
      if (!i.unresolvedLink) continue;
      const m = /href="([^"]*)"/.exec(i.message);
      const href = m ? m[1] : i.message;
      if (!seen.has(href)) seen.set(href, { href, files: [], inNav: false });
      const e = seen.get(href);
      e.files.push(i.file);
      // ナビの中か本文かで**壊れ方が違う**ので分ける。
      //   ナビ    → メニュー項目ごと消える（画面には出ない）
      //   本文    → 死んだリンクがそのまま残る（押すと 404）
      // 変換器は前者を報告しない（メニューは参照型で登録するため、
      // 行き先が無い項目は登録されずに落ちる）。lint L30 だけが両方見ている。
      if (isInNav(path.join(MOCKUP, i.file), href)) e.inNav = true;
    }
    return [...seen.values()];
  } catch {
    return null; // lint が動かない状態なら「取得できなかった」と書く
  }
}

// ページ一覧は**人が読むもの**なので、サイトの構造順に並べる（shared/page-order.js）。
function buildSiteMap(model, ord) {
  const rows = [];
  if (model.front) rows.push({ url: '/', what: 'トップページ', tpl: 'front-page.php', src: model.front.relPath });
  for (const [pageId, e] of model.pageMap) {
    rows.push({ url: `/${slugOfPageId(pageId)}/`, what: '固定ページ', tpl: `page-${pageId}.php`, src: e.page.relPath });
  }
  for (const [cpt, e] of model.cptMap) {
    if (e.archivePage) {
      rows.push({
        url: `/${archiveSlugOf(e.archivePage.relPath)}/`,
        what: `${e.label} の一覧`,
        tpl: `archive-nkk_${cpt}.php`,
        src: e.archivePage.relPath,
      });
    }
    const base = e.archivePage ? archiveSlugOf(e.archivePage.relPath) : '(一覧なし)';
    for (const sp of e.singlePages) {
      rows.push({ url: `/${base}/<記事のスラッグ>/`, what: `${e.label} の詳細`, tpl: `single-nkk_${cpt}.php`, src: sp.relPath });
    }
    for (const [v, vp] of e.variantPages || []) {
      rows.push({ url: `/${base}/<記事のスラッグ>/${v}/`, what: `${e.label} の${v}`, tpl: `single-nkk_${cpt}-${v}.php`, src: vp.relPath });
    }
  }
  // src（モックの相対パス）を鍵に並べ替える
  return rows.sort(
    (a, b) => (ord.order.get(a.src) ?? Infinity) - (ord.order.get(b.src) ?? Infinity)
  );
}

function main() {
  const files = findHtmlFiles(MOCKUP);
  if (!files.length) {
    console.error(`HTMLファイルが見つかりません: ${MOCKUP}`);
    process.exit(2);
  }
  const errors = new ErrorCollector();
  errors.allowUnresolvedLinks = true; // 手順書を出すのが目的。ここで止めない
  const model = buildModel(files.map((f) => loadPage(f.abs, f.rel)), errors, {
    titleSeparator: conf.title_separator,
  });
  errors.throwIfAny();

  const themeSlug = path.basename(conf.theme_dir || '') || '<テーマ名>';
  const plugins = conf.plugins_required || [];
  const forms = [...model.forms.keys()];
  const navs = [...model.navMap.keys()];
  const site = model.siteTitle;
  const rows = buildSiteMap(model, orderOf(model.pages));
  const unresolved = unresolvedLinks();
  const L = [];

  L.push(`# 本番リリース手順書 — ${conf.project || ''}`);
  L.push('');
  L.push('<!-- ichiki release で自動生成。手で編集しても次回の生成で消えます -->');
  L.push('');
  L.push('上から順に実行してください。**「要記入」と書かれた箇所は、実行前に埋める必要があります。**');
  L.push('サーバやドメインの情報は機械が知りようがないため、空欄にしてあります。');
  L.push('');
  L.push('> **この文書は「本番サーバに載せて設定する」ための手順です。**');
  L.push('> サイトの中身が正しいか（見た目・文言・レスポンシブ・フォームの動作）は');
  L.push(`> **検収**の役目で、ここでは扱いません。`);
  L.push('>');
  L.push(`> - ${linkToTestspec('test-spec.md', 'テスト仕様書（C1）')} … 何をどう確認するか`);
  L.push(`> - ${linkToTestspec('l1-checklist.tsv', '検収シート（C3）')} … 目視で確認して判定を書き込む表`);
  L.push(`> - ${linkToTestspec('l1-guide.md', '検収ガイド')} … 判定に迷ったときの読みもの`);
  L.push('>');
  L.push('> 同じ確認を2つの文書に書くと、片方だけ直されてズレるためです。');
  L.push('> ここで見るのは**本番環境でしか起きないこと**だけです。');
  L.push('');

  if (conf.retrofit) {
    L.push('> **注意: このテーマは変換途中のモックから作られています。**');
    L.push('> 行き先の無いリンクが残ります。**検収で確認してから公開してください。**');
    L.push('> 管理画面にも警告が出ます。');
    L.push('');
  }

  L.push('## 0. 事前に用意するもの（要記入）');
  L.push('');
  L.push('| 項目 | 値 |');
  L.push('|---|---|');
  L.push('| 本番ドメイン | |');
  L.push('| サーバ（エックスサーバー）のアカウント | |');
  L.push('| FTP / SSH の接続先 | |');
  L.push('| WordPress の管理者アカウント | |');
  L.push('| 公開予定日 | |');
  L.push('');
  L.push('前提:');
  L.push('');
  L.push('- WordPress 6.5 以上 / PHP 8.1 以上 / クラシックテーマが動く状態');
  L.push(`- [ ] **検収が済んでいる**（${linkToTestspec('l1-checklist.tsv', '検収シート')} の目視確認が終わっている）`);
  L.push('');

  L.push('## 1. プラグインを入れて有効化する');
  L.push('');
  if (plugins.length) {
    for (const p of plugins) L.push(`- [ ] ${p}`);
    L.push('');
    L.push('**Advanced Custom Fields は無料版で構いません**（PRO 専用機能は使っていません）。');
  } else {
    L.push('- （`.ichiki.json` の `plugins_required` が空です。要記入）');
  }
  L.push('');

  L.push('## 2. テーマを入れて有効化する');
  L.push('');
  L.push(`テーマ名: \`${themeSlug}\``);
  L.push('');
  L.push('1. [ ] `ichiki build` が出したテーマ一式を `wp-content/themes/` にアップロードする');
  L.push('2. [ ] 管理画面の「外観 > テーマ」で有効化する');
  L.push('');

  L.push('## 3. 初期データを入れる');
  L.push('');
  L.push('テーマを有効化したあと、**管理画面を1回開くだけ**で入ります（固定ページ・CPT の初期記事・');
  L.push('フォーム・メニュー・サイト名が自動で作られます）。');
  L.push('');
  L.push('- [ ] 管理画面（`/wp-admin/`）を開く');
  L.push('- [ ] 「固定ページ」と各投稿タイプに記事ができていることを確認する');
  L.push('');
  L.push(`サイト名とキャッチフレーズも自動で入ります（サイト名「${site.siteName}」` +
    (site.tagline ? `／キャッチフレーズ「${site.tagline}」` : '') + '）。');
  L.push('');

  L.push('## 4. パーマリンクを設定する');
  L.push('');
  L.push('- [ ] 「設定 > パーマリンク」を開いて、そのまま「変更を保存」を押す');
  L.push('');
  L.push('**押さないと投稿タイプのページが 404 になります。** 設定を変える必要はなく、保存するだけです。');
  L.push('');

  L.push('## 5. メニューを確認する');
  L.push('');
  if (navs.length) {
    L.push('自動で作られます。「外観 > メニュー」で位置が割り当たっているか確認してください。');
    L.push('');
    for (const n of navs) L.push(`- [ ] ${n}`);
  } else {
    L.push('- （メニューの宣言がありません）');
  }
  L.push('');

  L.push('## 6. フォームの送信先を設定する（要記入）');
  L.push('');
  if (forms.length) {
    L.push('**ここは必ず手で設定してください。** 既定では WordPress の管理者メールアドレスに届きます。');
    L.push('');
    L.push('| フォーム | 送信先メールアドレス（要記入） |');
    L.push('|---|---|');
    for (const f of forms) L.push(`| ${f} | |`);
    L.push('');
    L.push('「お問い合わせ」からフォームを開き、「メール」タブの「送信先」を書き換えます。');
    L.push('');
    L.push('- [ ] 送信先を設定した');
    L.push('- [ ] **本番サーバから実際に送信して、受信できた**');
    L.push('');
    L.push('フォームが動くかどうかは検収で確認済みです。ここで見るのは**本番のメールサーバで');
    L.push('実際に届くか**で、これは環境が変わると結果が変わるため、本番でもう一度必要です。');
  } else {
    L.push('- （フォームの宣言がありません）');
  }
  L.push('');

  L.push('## 7. ページの一覧（参考）');
  L.push('');
  L.push('このテーマが出すページです。**見た目や文言の確認は検収で済んでいます。**');
  L.push('ここでは「本番サーバに載せたあと、ちゃんと開くか」だけを見ます');
  L.push('（サーバの設定やパーマリンクの反映漏れで 404 になることがあるため）。');
  L.push('');
  L.push('| URL | 内容 | テンプレート |');
  L.push('|---|---|---|');
  for (const r of rows) L.push(`| \`${r.url}\` | ${r.what} | \`${r.tpl}\` |`);
  L.push('');
  L.push('- [ ] 各種別から1つずつ開いて 404 にならない（トップ / 固定ページ / 一覧 / 詳細）');
  L.push('');

  L.push('## 8. 画像を入れる');
  L.push('');
  L.push('初期データと一緒にメディアライブラリへ登録されます。差し替えたい画像は');
  L.push('管理画面の各ページの編集欄から選び直してください。');
  L.push('');

  // 「残っているリンク切れ」は載せない。**リリースの手順ではない。**
  // 本文のリンク切れは C1 の「リンク遷移」が全ページ自動判定していて、
  // ナビの欠落は verify:live の nav-short が出す。どちらも検収の側の仕事。
  // 同じことを2つの文書に書くと片方だけ直されてズレる（表示確認・レスポンシブで同じ判断をした）。
  // 公開してよいかどうかは 0章の「検収が済んでいる」で担保する。

  L.push('## 9. 公開前の最終確認');
  L.push('');
  L.push('本番環境でしか確認できないことだけを挙げます（中身の確認は検収の役目）。');
  L.push('');
  L.push('- [ ] 検索エンジンによるインデックスを許可した（「設定 > 表示設定」のチェックを外す）');
  L.push('- [ ] **検収用に置いたモックを消した**（`ichiki publish-mockup --remove`）');
  L.push('- [ ] SSL（https）で表示される');
  L.push('- [ ] 管理者アカウントのパスワードを本番用にした');
  L.push('');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
  console.log(`リリース手順書: ${path.relative(process.cwd(), OUT)}`);
  console.log(`  ページ ${rows.length}件 / フォーム ${forms.length}件 / メニュー ${navs.length}件`);
  console.log(
    `  行き先の無いリンク: ${unresolved === null ? '取得できず' : unresolved.length + '種類'}` +
      '（手順書には載せません。検収の「リンク遷移」と verify:live が見ています）'
  );
  if (conf.retrofit) console.log('  ※ リバース途中である旨を先頭に入れました');
}

try {
  main();
} catch (err) {
  if (err && err.isConversionError) {
    console.error(`リリース手順書を出せません:\n${err.message}`);
    process.exit(1);
  }
  throw err;
}
