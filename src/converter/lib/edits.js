'use strict';

// 元のHTML文字列に対する「[start,end) を replacement に置き換える」編集の集合を、
// オフセットの降順で適用するヘルパー。降順に適用することで、前方の編集が後方編集の
// オフセットに影響しない（cheerio 再シリアライズを使わない = 構造を1:1保持する要）。
class EditList {
  constructor(html) {
    this.html = html;
    this.edits = [];
  }

  replace(start, end, replacement) {
    if (start == null || end == null || start > end) {
      throw new Error(`EditList.replace: invalid range [${start}, ${end})`);
    }
    this.edits.push({ start, end, replacement });
  }

  remove(start, end) {
    this.replace(start, end, '');
  }

  insertBefore(offset, text) {
    this.edits.push({ start: offset, end: offset, replacement: text });
  }

  apply() {
    const sorted = [...this.edits].sort((a, b) => b.start - a.start || b.end - a.end);
    // 重複/交差チェック（降順で見ていくので、直前(=より後方)の start より
    // 今回の end が大きければ交差している）
    let prevStart = Infinity;
    for (const e of sorted) {
      if (e.end > prevStart) {
        throw new Error(`EditList.apply: overlapping edits detected near offset ${e.start}`);
      }
      prevStart = e.start;
    }

    let out = this.html;
    for (const e of sorted) {
      out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
    }
    return out;
  }
}

module.exports = { EditList };
