#!/usr/bin/env node
'use strict';

// L1 向け検収ガイドの HTML 版（DOCS-GAP #6）。
//
// この文書は**使い方だけ**を持つ。ページごとの見本は持たない。
//
// 当初は全11ページ分の絵を埋めていた（22枚・4.7MB）。冗長だった:
//   - `ichiki diff` の比較レポートが既に全ページのモックと実サイトを並べている
//   - `ichiki publish-mockup` でモックを公開サイトの配下に置けば、
//     検収シートに「実際のページ」と「合意したデザイン」の URL を2つ持たせられる。
//     **実物を見比べられるので絵は要らない**（スマホでも見られる）
//   - 「使い方」と「見本」は別の仕事。混ぜると使い方が読まれなくなる
//
// モックを置いていない案件では、見比べる先が無いので絵を1枚だけ出して
// 「こう見比べる」を示す。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const conf = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, '.ichiki.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const TS = conf.testspec || {};
const OUT_DIR = path.resolve(ROOT, TS.out_dir || 'docs/検収');
const VISUAL_DIR = path.resolve(ROOT, TS.visual_report || 'docs/visual');
const OUT = path.join(OUT_DIR, 'l1-guide.html');
const THUMB_WIDTH = 480; // 一覧に並べて見える幅。原寸は実サイトを開けば見られる
// 見出しに毎回サイト名が付くと読みにくい。区切り文字は案件の設定から取る。
const SEP = conf.title_separator || ' | ';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// TSV から確認対象を読む（検収シートと同じ集合を見る。別に組み立てると必ずズレる）
function readChecklist() {
  const f = path.join(OUT_DIR, 'l1-checklist.tsv');
  if (!fs.existsSync(f)) return null;
  const lines = fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim().split('\n');
  const rows = lines.slice(1).map((l) => l.split('\t'));
  const byUrl = new Map();
  for (const r of rows) {
    const [page, url, kind] = r;
    if (!byUrl.has(url)) byUrl.set(url, { page, url, kinds: [] });
    byUrl.get(url).kinds.push(kind);
  }
  return [...byUrl.values()];
}

// diff が出した pages.json（ラベル ↔ URL）。画像のファイル名はラベルから決まる。
function readPagesMap() {
  const f = path.join(VISUAL_DIR, 'pages.json');
  if (!fs.existsSync(f)) return new Map();
  const list = JSON.parse(fs.readFileSync(f, 'utf8'));
  const m = new Map();
  for (const p of list) m.set(p.wp, p.label.replace(/[^\w　-鿿]/g, '_'));
  return m;
}

async function makeThumbs(files) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = new Map();
  for (const [key, abs] of files) {
    if (!fs.existsSync(abs)) continue;
    const b64 = fs.readFileSync(abs).toString('base64');
    // 画像をブラウザに読ませて、幅を縮めて JPEG で撮り直す。
    // 縦長のフルページなので、縦は成り行きに任せる。
    const dim = await page.evaluate(
      ({ src, w }) =>
        new Promise((resolve) => {
          const im = new Image();
          im.onload = () => resolve({ w, h: Math.round((im.naturalHeight * w) / im.naturalWidth) });
          im.onerror = () => resolve(null);
          im.src = src;
        }),
      { src: `data:image/png;base64,${b64}`, w: THUMB_WIDTH }
    );
    if (!dim) continue;
    await page.setViewportSize({ width: dim.w, height: Math.min(dim.h, 20000) });
    await page.setContent(
      `<style>html,body{margin:0}img{display:block;width:${dim.w}px}</style>` +
        `<img src="data:image/png;base64,${b64}">`
    );
    const buf = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 70 });
    out.set(key, `data:image/jpeg;base64,${buf.toString('base64')}`);
  }
  await browser.close();
  return out;
}

async function main() {
  const items = readChecklist();
  if (!items) {
    console.error(`l1-checklist.tsv がありません: ${OUT_DIR}`);
    console.error('先に `ichiki testspec` を実行してください。');
    process.exit(2);
  }
  const labelOf = readPagesMap();

  // 使うのは**1ページ分だけ**（見比べ方の例）。22枚作って1枚しか出さないのは無駄。
  const wanted = new Map();
  for (const it of items) {
    const label = labelOf.get(new URL(it.url).pathname);
    if (!label) continue;
    const cand = ['desktop', 'mobile'].map((vp) => [vp, path.join(VISUAL_DIR, `${label}_${vp}_mockup.png`)]);
    if (!cand.some(([, f]) => fs.existsSync(f))) continue;
    for (const [vp, f] of cand) wanted.set(`${it.url}#${vp}`, f);
    break;
  }
  const thumbs = wanted.size ? await makeThumbs(wanted) : new Map();
  if (!thumbs.size) {
    console.warn('※ 絵がありません。`ichiki diff <モック> <サイトURL> <出力先> --both` を先に実行すると絵つきになります。');
  }

  const md = fs.readFileSync(path.join(OUT_DIR, 'l1-guide.md'), 'utf8');
  const intro = md
    .split('\n## ')
    .slice(1)
    .map((sec) => {
      const [head, ...body] = sec.split('\n');
      return { head: head.trim(), body: body.join('\n').trim() };
    });

  const H = [];
  H.push('<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">');
  H.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  H.push('<title>確認シートの使い方</title>');
  H.push(`<style>
    body{font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;
         line-height:1.9;max-width:960px;margin:0 auto;padding:24px;color:#222}
    h1{font-size:1.6rem;border-bottom:3px solid #2e7d32;padding-bottom:.4em}
    h2{font-size:1.25rem;margin-top:2.2em;border-left:6px solid #2e7d32;padding-left:.5em}
    h3{font-size:1.05rem;margin-top:1.6em}
    .lead{background:#f1f8e9;padding:16px 20px;border-radius:8px}
    .page{border:1px solid #ddd;border-radius:8px;padding:16px;margin:20px 0}
    .page h3{margin-top:0}
    .shots{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
    .shot{flex:1 1 300px;min-width:0}
    .shot span{display:block;font-size:.85rem;color:#666;margin-bottom:4px}
    .shot img{width:100%;border:1px solid #ccc;border-radius:4px}
    .note{background:#fff8e1;border-left:4px solid #f9a825;padding:10px 14px;margin:10px 0;font-size:.92rem}
    a{color:#1565c0}
    ul{padding-left:1.4em}
  </style></head><body>`);
  H.push('<h1>確認シートの使い方</h1>');

  for (const sec of intro) {
    if (sec.head === '手順') {
      H.push(`<h2>${esc(sec.head)}</h2>`);
      H.push('<div class="lead">' + mdToHtml(sec.body) + '</div>');
    } else {
      H.push(`<h2>${esc(sec.head)}</h2>`);
      H.push(mdToHtml(sec.body));
    }
  }

  if (thumbs.size) {
    H.push('<h2>見比べ方</h2>');
    H.push('<p>下は<strong>合意したデザイン</strong>の例です。実際のページを開いて、この形に見えるかを確認します。</p>');
    H.push('<div class="note">絵と実際のページで、<strong>並んでいる記事の数が違うことがあります</strong>。');
    H.push('絵はデザインを見せるための見本で、実際のページには登録された記事の数だけ並びます。');
    H.push('数の違いは問題ではありません。</div>');
    const first = items.find((it) => thumbs.get(`${it.url}#desktop`) || thumbs.get(`${it.url}#mobile`));
    if (first) {
      const d = thumbs.get(`${first.url}#desktop`);
      const m = thumbs.get(`${first.url}#mobile`);
      H.push('<div class="page">');
      H.push(`<h3>例: ${esc((first.page.split(SEP)[0] || first.page))}</h3>`);
      H.push(`<p><a href="${esc(first.url)}" target="_blank">実際のページを開く →</a></p>`);
      H.push('<div class="shots">');
      if (d) H.push(`<div class="shot"><span>パソコンでの見え方</span><img src="${d}" alt=""></div>`);
      if (m) H.push(`<div class="shot"><span>スマホでの見え方</span><img src="${m}" alt=""></div>`);
      H.push('</div></div>');
    }
    H.push('<p>ほかのページも同じように見比べてください。');
    H.push('確認するページの一覧と、それぞれの「合意したデザイン」の場所は<strong>確認シート</strong>に入っています。</p>');
  }

  H.push('</body></html>');
  fs.writeFileSync(OUT, H.join('\n'), 'utf8');
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`検収ガイド(HTML): ${path.relative(process.cwd(), OUT)}  ${kb}KB`);
  console.log(`  絵: ${thumbs.size}枚（見比べ方の例。幅${THUMB_WIDTH}px に縮小して埋め込み）`);
}

// ガイドの md はごく単純な書式しか使わない（見出し・箇条書き・入れ子・太字・段落）。
// Markdown ライブラリを足すほどではないので、その範囲だけ変換する。
//
// 素朴に「1行 = 1段落」にすると崩れる（実測: 折り返しただけの2行が別の段落になり、
// 入れ子の箇条書きが平坦化して番号が 5,6,7,8 と続いてしまった）。
//   - 空行までを1段落にまとめる
//   - 行頭の空白の深さで入れ子にする
function mdToHtml(md) {
  const out = [];
  const stack = []; // [{ tag, indent }]
  let para = [];

  const flushPara = () => {
    if (para.length) { out.push(`<p>${inline(para.join(''))}</p>`); para = []; }
  };
  const closeTo = (indent) => {
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      out.push(`</${stack.pop().tag}>`);
    }
  };

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); closeTo(0); continue; }

    const m = /^(\s*)(?:([-*])|(\d+)\.) (.*)$/.exec(line);
    if (m) {
      flushPara();
      const indent = m[1].length;
      const tag = m[2] ? 'ul' : 'ol';
      closeTo(indent + 1);
      if (!stack.length || stack[stack.length - 1].indent < indent) {
        out.push(`<${tag}>`);
        stack.push({ tag, indent });
      }
      out.push(`<li>${inline(m[4])}</li>`);
      continue;
    }

    // 箇条書きの続き（インデントされた通常行）は直前の項目の続きとして扱う
    if (stack.length && /^\s+/.test(raw)) {
      const last = out.length - 1;
      if (out[last] && out[last].startsWith('<li>')) {
        out[last] = out[last].replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>');
        continue;
      }
    }
    closeTo(0);
    para.push(line.trim());
  }
  flushPara();
  closeTo(0);
  return out.join('\n');
}
function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

main();
