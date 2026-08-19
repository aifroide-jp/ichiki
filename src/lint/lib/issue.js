'use strict';

// 共通の issue オブジェクトを作るヘルパー。
// file: ページの相対パス, line: 1-based行番号(不明ならnull)
function mk(page, rule, severity, line, message) {
  return {
    file: page.relPath,
    line: line == null ? null : line,
    rule,
    severity,
    message,
  };
}

module.exports = { mk };
