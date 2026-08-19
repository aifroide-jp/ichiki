'use strict';

// L14: 画像参照が images/ 配下のみ
// L15: 全 <img> に alt (空 alt は data-deco 付きのみ許可)
// L16: images/ の全ファイルが meta.yaml に載っている
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { mk } = require('../lib/issue');

function hasAncestorOrSelfAttr($el, attrName) {
  let cur = $el;
  while (cur && cur.length) {
    if (cur.attr(attrName) !== undefined) return true;
    cur = cur.parent();
  }
  return false;
}

function hasAncestorOrSelfAttrValue($el, attrName, value) {
  let cur = $el;
  while (cur && cur.length) {
    if (cur.attr(attrName) === value) return true;
    cur = cur.parent();
  }
  return false;
}

function runPerPage(page, rootDir) {
  const issues = [];
  const $ = page.$;
  const pageDir = path.dirname(page.absPath);

  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src');
    const line = page.lineOf($el);

    if (!src) {
      issues.push(mk(page, 'L14', 'error', line, '<img> に src がありません'));
    } else if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) {
      issues.push(mk(page, 'L14', 'error', line, `画像参照が外部URL/データURIです(禁止): ${src}`));
    } else {
      const cleanSrc = src.split('?')[0].split('#')[0];
      // "/images/..." のようなサイトルート絶対パスは rootDir 基準、それ以外は
      // 参照元ページのディレクトリ基準で解決する。
      const base = cleanSrc.startsWith('/') ? rootDir : pageDir;
      const abs = path.normalize(path.join(base, cleanSrc));
      const relFromRoot = path.relative(rootDir, abs).split(path.sep).join('/');
      if (relFromRoot.startsWith('..') || !relFromRoot.startsWith('images/')) {
        issues.push(mk(page, 'L14', 'error', line, `画像参照が images/ 配下ではありません: ${src}`));
      }
    }

    const hasAlt = $el.attr('alt') !== undefined;
    if (!hasAlt) {
      issues.push(mk(page, 'L15', 'error', line, '<img> に alt 属性がありません'));
    } else if ($el.attr('alt') === '') {
      // 空 alt が許されるのは「支援技術に対して装飾と明示されている」場合。
      // data-deco だけでなく aria-hidden="true" も同じ意味を持つ
      // （例: カルーセルの無限ループ用に複製されたカードは aria-hidden で読み上げから外す）。
      const decoDeclared =
        hasAncestorOrSelfAttr($el, 'data-deco') || hasAncestorOrSelfAttrValue($el, 'aria-hidden', 'true');
      if (!decoDeclared) {
        issues.push(
          mk(page, 'L15', 'error', line, 'alt="" ですが data-deco も aria-hidden="true" もありません(装飾画像として明示してください)')
        );
      }
    }
  });

  return issues;
}

function runImagesRegistry(rootDir) {
  const issues = [];
  const imagesDir = path.join(rootDir, 'images');
  if (!fs.existsSync(imagesDir)) return issues;

  const allFiles = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const rel = path.relative(imagesDir, abs).split(path.sep).join('/');
        if (rel !== 'meta.yaml') allFiles.push(rel);
      }
    }
  })(imagesDir);

  const metaPath = path.join(imagesDir, 'meta.yaml');
  if (!fs.existsSync(metaPath)) {
    issues.push({
      file: 'images/meta.yaml',
      line: null,
      rule: 'L16',
      severity: 'error',
      message: `images/meta.yaml が存在しません(images/ 配下 ${allFiles.length} 件のファイルが未登録です)`,
    });
    return issues;
  }

  let entries = [];
  try {
    const doc = yaml.load(fs.readFileSync(metaPath, 'utf8'));
    entries = Array.isArray(doc) ? doc : [];
  } catch (e) {
    issues.push({
      file: 'images/meta.yaml',
      line: null,
      rule: 'L16',
      severity: 'error',
      message: `images/meta.yaml のパースに失敗しました: ${e.message}`,
    });
    return issues;
  }

  const registered = new Set(entries.map((e) => e && e.file).filter(Boolean));
  for (const file of allFiles) {
    if (!registered.has(file)) {
      issues.push({
        file: `images/${file}`,
        line: null,
        rule: 'L16',
        severity: 'error',
        message: 'images/meta.yaml に記載がありません',
      });
    }
  }

  return issues;
}

module.exports = { runPerPage, runImagesRegistry };
