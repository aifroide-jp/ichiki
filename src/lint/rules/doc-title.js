'use strict';

// L32: 全ページの <title> が同じ「区切り + サイト名」で終わる。
//
// なぜモック側で検査するか:
//   `<title>` はモック作成時に書く文字列で、区切り文字とサイト名はそこで決まる。
//   変換時にしか見ていなかった頃は、51ページ書き上げたあとで
//   「区切りが案件の設定と違う」と言われることになり、気づくのが遅すぎた。
//   **ここはモック内だけで完結する検査**で、.ichiki.json を読まない。
//   1ページ目で決めた形に以降が揃っているかを、モック作成中に確認できる。
//
// 設定（.ichiki.json の title_separator）との一致は変換器が別に見る。二段構え。

const { mk } = require('../lib/issue');
// 区切りの割り出しは shared/site-title.js が唯一の実装。scan が同じ関数で
// .ichiki.json に書き込むので、lint が通ったモックと設定は定義上一致する。
const { deriveTitleSuffix } = require('../../shared/site-title');

function titleOf(page) {
  return page.$('title').first().text().trim();
}

function run(pages) {
  const issues = [];
  const targets = pages.filter((p) => p.$('body').attr('data-page') !== undefined);
  if (targets.length < 2) return issues;

  for (const p of targets) {
    if (!titleOf(p)) issues.push(mk(p, 'L32', 'error', 1, '<title> が空です'));
  }
  const withTitle = targets.filter((p) => titleOf(p));
  if (withTitle.length < 2) return issues;

  const front = withTitle.find((p) => p.$('body').attr('data-page') === 'front');
  const others = withTitle.filter((p) => p !== front);
  if (others.length < 2) return issues;

  // 区切りとサイト名を割り出す（共有実装）。
  const derived = deriveTitleSuffix(others.map((p) => ({ relPath: p.relPath, title: titleOf(p), page: p })));

  if (!derived.ok && derived.groups.length > 1) {
    const lines = derived.groups.map((g) => {
      const names = g.pages.slice(0, 3).map((x) => x.relPath).join(', ');
      const more = g.pages.length > 3 ? ` ほか${g.pages.length - 3}件` : '';
      const label = g.ending === null ? '（区切りなし）' : JSON.stringify(g.ending);
      return `      ${label}  ${g.pages.length}ページ (${names}${more})`;
    });
    issues.push(
      mk(others[0], 'L32', 'error', 1,
        '全ページの <title> の末尾が揃っていません（1.2節）。\n' +
          '    区切り文字とサイト名は全ページで同じにしてください。\n' +
          '    観測した末尾:\n' + lines.join('\n'))
    );
    return issues;
  }
  if (!derived.ok) {
    issues.push(
      mk(others[0], 'L32', 'error', 1,
        '<title> に区切り文字がありません（1.2節）。\n' +
          '    「ページ名 + 区切り + サイト名」の形にしてください。')
    );
    return issues;
  }
  const { separator: sep, siteName, suffix } = derived;

  // 一覧ページの名前（中間区画に使える文字）を集める
  const archiveLabel = new Map(); // cpt -> 一覧ページ名
  for (const p of withTitle) {
    if (p.$('body').attr('data-page') !== 'archive') continue;
    const cpt = p.$('body').attr('data-cpt');
    const t = titleOf(p);
    if (cpt && t.endsWith(suffix)) archiveLabel.set(cpt, t.slice(0, -suffix.length));
  }

  for (const p of withTitle) {
    const t = titleOf(p);
    const dataPage = p.$('body').attr('data-page');
    if (dataPage === 'front') {
      if (!t.startsWith(siteName)) {
        issues.push(
          mk(p, 'L32', 'error', 1,
            `トップの <title> はサイト名 ${JSON.stringify(siteName)} で始めてください（1.2節）。\n` +
              `    このページ: ${JSON.stringify(t)}`)
        );
      }
      continue;
    }
    if (!t.endsWith(suffix)) {
      issues.push(
        mk(p, 'L32', 'error', 1,
          `<title> が他のページと同じ末尾で終わっていません（1.2節）。\n` +
            `    他のページ: ${JSON.stringify(suffix)}\n` +
            `    このページ: ${JSON.stringify(t)}`)
      );
      continue;
    }
    // 中間区画
    const head = t.slice(0, -suffix.length);
    const at2 = head.lastIndexOf(sep);
    if (at2 < 0) continue;
    const middle = head.slice(at2 + sep.length);
    const label = dataPage === 'single' ? archiveLabel.get(p.$('body').attr('data-cpt')) : undefined;
    if (label === undefined) {
      issues.push(
        mk(p, 'L32', 'error', 1,
          `<title> の中間区画 ${JSON.stringify(middle)} は使えません（1.2節）。\n` +
            `    中間区画を挟めるのは詳細ページ（data-page="single"）だけで、\n` +
            `    値は一覧ページの名前と同じにしてください。`)
      );
    } else if (middle !== label) {
      issues.push(
        mk(p, 'L32', 'error', 1,
          `<title> の中間区画が一覧ページの名前と違います（1.2節）。\n` +
            `    一覧ページ: ${JSON.stringify(label)}\n` +
            `    このページ: ${JSON.stringify(middle)}`)
      );
    }
  }
  return issues;
}

module.exports = { run };
