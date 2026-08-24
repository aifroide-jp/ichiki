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

const ROOT = path.resolve(process.argv[2] || process.cwd());
const { conf } = readConfig(ROOT);
const MOCKUP = path.resolve(ROOT, conf.mockup || './');
const OUT = path.resolve(ROOT, (conf.release && conf.release.out) || 'docs/リリース手順書.md');

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

function buildSiteMap(model) {
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
  return rows;
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
  const rows = buildSiteMap(model);
  const unresolved = unresolvedLinks();
  const L = [];

  L.push(`# 本番リリース手順書 — ${conf.project || ''}`);
  L.push('');
  L.push('<!-- ichiki release で自動生成。手で編集しても次回の生成で消えます -->');
  L.push('');
  L.push('上から順に実行してください。**「要記入」と書かれた箇所は、実行前に埋める必要があります。**');
  L.push('サーバやドメインの情報は機械が知りようがないため、空欄にしてあります。');
  L.push('');

  if (conf.retrofit) {
    L.push('> **注意: このテーマは変換途中のモックから作られています。**');
    L.push('> 行き先の無いリンクが残ります（下の「9. 残っているリンク切れ」を必ず確認してください）。');
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
  L.push('前提: WordPress 6.5 以上 / PHP 8.1 以上 / クラシックテーマが動く状態。');
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
    L.push('- [ ] 送信先を設定した');
    L.push('- [ ] **実際に送信して受信を確認した**（届かないことがあるため、必ず実物で確かめる）');
  } else {
    L.push('- （フォームの宣言がありません）');
  }
  L.push('');

  L.push('## 7. 画面を確認する');
  L.push('');
  L.push('| URL | 内容 | テンプレート |');
  L.push('|---|---|---|');
  for (const r of rows) L.push(`| \`${r.url}\` | ${r.what} | \`${r.tpl}\` |`);
  L.push('');
  L.push('- [ ] 上のページがすべて開ける');
  L.push('- [ ] スマートフォンの幅でも崩れていない');
  L.push('');

  L.push('## 8. 画像を入れる');
  L.push('');
  L.push('初期データと一緒にメディアライブラリへ登録されます。差し替えたい画像は');
  L.push('管理画面の各ページの編集欄から選び直してください。');
  L.push('');

  L.push('## 9. 残っているリンク切れ');
  L.push('');
  if (unresolved === null) {
    L.push('> **取得できませんでした**（lint が実行できていません）。`ichiki lint` を通してから出し直してください。');
  } else if (unresolved.length === 0) {
    L.push('ありません。');
  } else {
    const inNav = unresolved.filter((u) => u.inNav);
    const inBody = unresolved.filter((u) => !u.inNav);
    L.push(`**${unresolved.length} 種類のリンクに行き先がありません。** 壊れ方が2通りあります。`);
    L.push('');
    const table = (list) => {
      L.push('| リンク先 | 書かれているページ |');
      L.push('|---|---|');
      for (const u of list) {
        const files = [...new Set(u.files)];
        const shown = files.slice(0, 3).join('<br>') + (files.length > 3 ? `<br>ほか${files.length - 3}件` : '');
        L.push(`| \`${u.href}\` | ${shown} |`);
      }
      L.push('');
    };
    if (inNav.length) {
      L.push(`### ナビゲーションの中（${inNav.length}種類）— **メニュー項目ごと表示されません**`);
      L.push('');
      L.push('行き先が無い項目はメニューに登録されないため、画面に出ません。');
      L.push('リンク切れにはなりませんが、**あるはずの項目が無い**状態になります。');
      L.push('');
      table(inNav);
    }
    if (inBody.length) {
      L.push(`### 本文の中（${inBody.length}種類）— **押すと 404 になります**`);
      L.push('');
      L.push('死んだリンクがそのままページに残ります。');
      L.push('');
      table(inBody);
    }
    L.push('公開前にどうするか決めてください（ページを作る／リンクを外す／別のページへ向ける）。');
    L.push('');
    L.push('- [ ] すべてについて対応を決めた');
  }
  L.push('');

  L.push('## 10. 公開前の最終確認');
  L.push('');
  L.push('- [ ] `docs/検収/l1-checklist.tsv` の目視確認が済んでいる');
  L.push('- [ ] フォームの受信を実物で確認した');
  L.push('- [ ] 検索エンジンによるインデックスを許可した（「設定 > 表示設定」のチェックを外す）');
  L.push('- [ ] SSL（https）で表示される');
  L.push('- [ ] 管理者アカウントのパスワードを本番用にした');
  L.push('');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
  console.log(`リリース手順書: ${path.relative(process.cwd(), OUT)}`);
  console.log(`  ページ ${rows.length}件 / フォーム ${forms.length}件 / メニュー ${navs.length}件`);
  console.log(`  行き先の無いリンク: ${unresolved === null ? '取得できず' : unresolved.length + '種類'}`);
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
