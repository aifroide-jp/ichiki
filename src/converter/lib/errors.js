'use strict';

// 変換器のエラー方針（vocabulary.md 0章3節・10章）:
// 宣言が見つからない・想定外の構造・置換元が見つからない場合は、
// 黙って握りつぶさず・デフォルトにフォールバックせず、エラーを蓄積してから
// 非ゼロ終了する。1件見つかった時点で即死しない（全件を一度に報告し、
// 手直しの往復回数を減らす）。

class ErrorCollector {
  constructor() {
    this.errors = [];
    this.warnings = [];
    // --- 一時的なエスケープハッチ（既定は false） ---
    // 未解決の内部リンクをエラーではなく警告にする。設計原則3（エスケープハッチを
    // 作らない）に反するため、**既定では絶対に有効にしない**。
    // 用途: モックのページを揃える途中で、まだ存在しないページへのリンクを理由に
    // 変換が止まるのを避け、WordPress 上での動作確認まで先に進めるため。
    // 外す条件: 全ページが揃った時点。外し忘れると、行き先の無いリンクを含む
    // テーマがそのまま本番に出る。
    this.allowUnresolvedLinks = false;
  }

  add(file, line, message) {
    this.errors.push({ file, line: line == null ? '-' : line, message });
  }

  warn(file, line, message) {
    this.warnings.push({ file, line: line == null ? '-' : line, message });
  }

  get hasErrors() {
    return this.errors.length > 0;
  }

  // 警告の要約。生成が成功しても必ず出す（見逃されないようにする）。
  warningReport() {
    if (this.warnings.length === 0) return null;
    const lines = ['', `警告 ${this.warnings.length} 件（生成は続行しました）:`, ''];
    for (const w of this.warnings) lines.push(`  ${w.file}:${w.line}  ${w.message}`);
    if (this.allowUnresolvedLinks) {
      lines.push('');
      lines.push('  ※ --allow-unresolved-links を渡しています。未解決リンクを警告に落としています。');
      lines.push('     行き先の無いリンクがテーマに残ります。全ページが揃ったら必ず外してください。');
    }
    return lines.join('\n');
  }

  report() {
    const lines = ['変換エラー: 以下の箇所で変換器が停止しました（黙ってフォールバックしていません）。', ''];
    for (const e of this.errors) {
      lines.push(`  ${e.file}:${e.line}  ${e.message}`);
    }
    lines.push('');
    lines.push(`合計 ${this.errors.length} 件のエラー。テーマは生成していません。`);
    return lines.join('\n');
  }

  throwIfAny() {
    if (this.hasErrors) {
      const err = new Error(this.report());
      err.isConversionError = true;
      throw err;
    }
  }
}

module.exports = { ErrorCollector };
