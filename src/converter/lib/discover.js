'use strict';

const fs = require('fs');
const path = require('path');

// ディレクトリ配下の *.html を再帰的に収集する（node_modules・隠しディレクトリは除外）。
function findHtmlFiles(rootDir) {
  const results = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        if (entry.name.startsWith('.')) continue;
        walk(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        results.push(abs);
      }
    }
  }

  walk(rootDir);
  results.sort();
  return results.map((abs) => ({
    abs,
    rel: path.relative(rootDir, abs).split(path.sep).join('/'),
  }));
}

module.exports = { findHtmlFiles };
