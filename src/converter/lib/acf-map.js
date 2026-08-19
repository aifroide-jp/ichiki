'use strict';

// acf-map.yaml を「宣言の解釈結果」の正として扱う（Ichiki Phase0 の出力）。
//
// なぜ経由するのか:
//   モックから直接テーマを出すと、**変換器がモックをどう読んだかがどこにも残らない**。
//   人が確認・修正できる中間物が無いため、読み違いは生成物を読むまで分からない。
//   さらに acf-map.yaml は検収成果物の入力でもある
//   （scripts/test-spec/generate.js が C1 テスト仕様書 / C3 検収シートを組み立てる）。
//   中間物を廃すると検収の自動生成ごと失う。
//
// ただし **yaml だけではテンプレートを作れない**。マークアップの骨格は yaml に無く、
// モックの HTML にしかない（yaml が持つ HTML は wysiwyg の default 値だけ）。
// なので役割はこうなる:
//   モック HTML  … 唯一の入力元（お客様と合意した設計そのもの）
//   acf-map.yaml … それを読んだ結果の記録。人が読める・検収の入力になる
//
// 変換器は yaml を**上書き元としては使わない**。scan と convert は同じモックを読む
// 2つの独立した実装なので、**両者の読みが一致するかを突き合わせる**ことに意味がある。
// 食い違えば、どちらかにバグがある。黙って片方に寄せると、その事実が消える。
// （実測: 上書きにすると共有フィールドが書き換わり、次のページで2次的な誤報が出た）
//
// 直したいときはモックを直して scan を回し直す。yaml だけを書き換えても通らない。

const fs = require('fs');
const yaml = require('js-yaml');

// yaml から「ページ相対パス → フィールド名 → {type, default}」を作る。
// common は全ページ共通なので別建てにする。
function loadAcfMap(mapPath) {
  const doc = yaml.load(fs.readFileSync(mapPath, 'utf8'));
  const byPage = new Map();
  const common = new Map();

  for (const entry of doc.common || []) {
    for (const f of entry.fields || []) {
      common.set(f.field_name, { type: f.type, default: f.default });
    }
  }

  for (const page of doc.pages || []) {
    const fields = new Map();
    const collect = (list) => {
      for (const f of list || []) fields.set(f.field_name, { type: f.type, default: f.default });
    };
    for (const s of page.sections || []) collect(s.fields);
    collect(page.decoration);
    for (const l of page.loops || []) for (const n of l.item_fields || []) if (!fields.has(n)) fields.set(n, null);
    byPage.set(page.file, {
      pageType: page.page_type,
      cpt: page.cpt || null,
      pageId: page.page_id || null,
      variant: page.variant || null,
      css: page.css || [],
      fields,
    });
  }

  return { byPage, common, raw: doc };
}

// モックから組んだ model と yaml が一致するかを見る。
// 一致しない＝どちらかが古い。推測で寄せずに止める。
function checkAgainstModel(map, pages, errors) {
  for (const page of pages) {
    if (!page.dataPage) continue;
    const m = map.byPage.get(page.relPath);
    if (!m) {
      errors.add(page.relPath, 1, 'acf-map.yaml にこのページの項目がありません（scan を回し直してください）');
      continue;
    }
    if (m.pageType !== page.dataPage) {
      errors.add(page.relPath, 1, `data-page が acf-map.yaml と違います（yaml: ${m.pageType} / モック: ${page.dataPage}）`);
    }
    if ((m.cpt || null) !== (page.cpt || null)) {
      errors.add(page.relPath, 1, `data-cpt が acf-map.yaml と違います（yaml: ${m.cpt} / モック: ${page.cpt}）`);
    }
    if ((m.variant || null) !== (page.variant || null)) {
      errors.add(page.relPath, 1, `data-page-variant が acf-map.yaml と違います（yaml: ${m.variant} / モック: ${page.variant}）`);
    }
  }
}

// scan の読み（yaml）と convert の読み（model）が一致するかを見る。上書きはしない。
function checkFieldTypes(map, fields, relPath, errors) {
  for (const f of fields) {
    const spec = map.byPage.get(relPath)?.fields.get(f.name) || map.common.get(f.name);
    if (!spec) continue; // ループ項目の合流などで yaml 側に無いことがある
    if (spec.type && spec.type !== f.type) {
      errors.add(relPath, null, `${f.name}: 型が acf-map.yaml と違います（yaml: ${spec.type} / モック: ${f.type}）`);
    }
  }
}

module.exports = { loadAcfMap, checkAgainstModel, checkFieldTypes };
