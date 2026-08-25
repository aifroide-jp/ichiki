'use strict';

// L18: 見出しレベルの飛びが無い(h1→h3 等)。body 内の h1〜h6 を DOM 出現順に見る。
const { mk } = require('../lib/issue');

const HEADING_RE = /^h[1-6]$/;

function collectHeadingsInOrder(node, out) {
  if (!node) return;
  if (node.type === 'tag') {
    const tag = (node.name || '').toLowerCase();
    if (HEADING_RE.test(tag)) {
      out.push({ level: Number(tag[1]), node });
    }
  }
  if (node.children) {
    for (const child of node.children) collectHeadingsInOrder(child, out);
  }
}

function run(page) {
  const issues = [];
  const body = page.$('body').get(0);
  if (!body) return issues;

  const headings = [];
  collectHeadingsInOrder(body, headings);

  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const cur = headings[i];
    if (cur.level - prev.level >= 2) {
      const loc = cur.node.sourceCodeLocation;
      const line = loc ? loc.startLine : null;
      issues.push(mk(page, 'L18', 'error', line, `見出しレベルが h${prev.level} から h${cur.level} に飛んでいます`));
    }
  }

  return issues;
}

module.exports = { run };
