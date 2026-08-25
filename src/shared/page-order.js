'use strict';

// 人が読むものに並べる順を与える。**唯一の実装。**
//
// なぜ要るか:
//   探索（shared/discover.js）はモックのファイルパス順で、これは機械のための順序。
//   そのまま人に見せると直感に反する。実測:
//     center/biotope（詳細）が center（一覧）より前  … biotope.html < index.html
//     front（トップ）が9番目                        … f が中盤だから
//   さらに C1 / C3 / 検収ガイド / 見た目の比較 / リリース手順書 が
//   **全部バラバラの順**で並んでいた。
//
// 並べ方（すべて宣言が根拠。推測しない）:
//   1. トップは必ず先頭
//   2. セクションの順は `data-nav` に書かれたリンクの順に従う
//      （＝お客様と合意した並び。サイトを見る順そのもの）
//   3. セクション内は 一覧 → 詳細 → variant
//   4. ナビから辿れないページは末尾。**どこにも載っていないことが見える**
//
// 機械の順序（discover.js）は変えない。あれを変えると生成物の中身や凍結まで動く。

// リンクの正規化は変換器と同じ実装を使う（別に書くとズレる）。
const { sitePathForRel, classifyHref } = require('../converter/lib/link-resolve');

// nav に書かれたリンクの順。同じサイトパスが複数回出たら最初の位置を採る。
// どの nav を使うかは決め打ちしない（宣言されている nav 全部を出現順に見る）。
function navRank(pages) {
  const rank = new Map(); // サイトパス -> 順位
  let n = 0;
  for (const p of pages) {
    if (!p.$) continue;
    p.$('[data-nav] a[href]').each((_, a) => {
      const href = p.$(a).attr('href') || '';
      const c = classifyHref(href, p.relPath);
      if (c.kind !== 'internal') return;
      if (!rank.has(c.sitePath)) rank.set(c.sitePath, n++);
    });
  }
  return rank;
}

const KIND_RANK = { front: 0, page: 1, archive: 2, single: 3 };

// pages: buildModel を通した page（dataPage / relPath / cpt / variant / $ を持つ）
// 戻り値: relPath -> 並び順（数値）。小さいほど先。
function orderOf(pages) {
  const declared = pages.filter((p) => p.dataPage);
  const rank = navRank(declared);

  // CPT ごとの「セクションの位置」= その一覧ページが nav で何番目か
  const cptNav = new Map();
  for (const p of declared) {
    if (p.dataPage !== 'archive' || !p.cpt) continue;
    const sp = sitePathForRel(p.relPath);
    cptNav.set(p.cpt, rank.has(sp) ? rank.get(sp) : Infinity);
  }

  const NOT_IN_NAV = 1e6; // ナビから辿れないページはここから後ろ
  const keyOf = (p) => {
    if (p.dataPage === 'front') return [-1, 0, 0, ''];
    // 一覧・詳細は「その CPT のセクション位置」で並ぶ（詳細が一覧より前に来ない）
    const section = p.cpt !== undefined && p.cpt !== null ? cptNav.get(p.cpt) : undefined;
    const ownSp = sitePathForRel(p.relPath);
    const own = rank.has(ownSp) ? rank.get(ownSp) : undefined;
    const pos = section !== undefined && section !== Infinity ? section : own !== undefined ? own : NOT_IN_NAV;
    return [pos, KIND_RANK[p.dataPage] ?? 9, p.variant ? 1 : 0, p.relPath];
  };

  const sorted = [...declared].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] === kb[i]) continue;
      return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
  });

  const out = new Map();
  sorted.forEach((p, i) => out.set(p.relPath, i));
  // ナビから辿れないかどうかも返す（区切りを出せるように）
  const orphan = new Set(
    declared.filter((p) => keyOf(p)[0] === NOT_IN_NAV && p.dataPage !== 'front').map((p) => p.relPath)
  );
  return { order: out, orphan, sorted };
}

// 並べ替えたい配列と「その要素の relPath を取る関数」を渡す
function sortByPageOrder(items, relOf, ord) {
  return [...items].sort((a, b) => {
    const ra = ord.order.has(relOf(a)) ? ord.order.get(relOf(a)) : Infinity;
    const rb = ord.order.has(relOf(b)) ? ord.order.get(relOf(b)) : Infinity;
    return ra - rb;
  });
}

module.exports = { orderOf, sortByPageOrder };
